import fs from 'fs';
import path from 'path';

import { DOMAIN_SKILLS_DIR as SKILL_DIR, WORKFLOWS_DIR } from '../config.js';
import { redactCredentialArgs } from '../credentials.js';
import { computeElementHash, findElementsByHash, resolveHashToElement } from './element-hash.js';
import { elementToFingerprint, relocateFromPerception, calculateSimilarityScore } from './element-relocator.js';

function safeHost(hostname) {
  return String(hostname || 'unknown').toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}

export function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

export function loadDomainSkill(url) {
  const hostname = safeHost(hostnameFromUrl(url));
  const file = path.join(SKILL_DIR, `${hostname}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function actionElementHash(action = {}) {
  return action.elementHash || action.args?.elementHash || null;
}

function sameActionShape(skillAction, historyEntry) {
  if (!skillAction || !historyEntry) return false;
  if (skillAction.tool !== historyEntry.tool) return false;
  const skillHash = actionElementHash(skillAction);
  const histHash = historyEntry.elementHash || actionElementHash(historyEntry);
  if (skillHash && histHash) return skillHash === histHash;
  return true;
}

/**
 * Validate cached plan against executed history + current page elements.
 * Zero or multiple hash matches → abort cache for this run (Skyvern caching.py pattern).
 */
export function prepareDomainSkillForReplay(skill, observation, history = []) {
  if (!skill?.strategy?.length) return null;

  const elements = observation?.elements || [];
  const executed = history.filter(h =>
    h.tool && !['read', 'wait', 'screenshot'].includes(h.tool)
  );

  for (let i = 0; i < executed.length; i++) {
    const expected = skill.strategy[i];
    if (!expected || !sameActionShape(expected, executed[i])) {
      return {
        ...skill,
        strategy: [],
        skillReplay: { mode: 'fallback', reason: 'sequence_diverged', divergedAt: i }
      };
    }
  }

  const remaining = skill.strategy.slice(executed.length);
  const validated = [];

  for (const action of remaining) {
    const hash = actionElementHash(action);
    if (!hash) {
      validated.push(action);
      continue;
    }
    const { match, ambiguous, count } = resolveHashToElement(elements, hash);
    if (match && !ambiguous) {
      // Exact hash match — use it directly
      validated.push({
        ...action,
        args: {
          ...action.args,
          ref: match.ref,
          selector: match.selector,
          elementHash: hash
        }
      });
      continue;
    }

    // Hash miss → try adaptive relocation (Scrapling pattern)
    const savedFingerprint = action.fingerprint || action.args?.fingerprint;
    if (savedFingerprint && elements.length > 0) {
      const relocated = relocateFromPerception(savedFingerprint, elements, 45);
      if (relocated.match) {
        console.log(`  [RELOCATOR] Fuzzy-matched element (score: ${relocated.score.toFixed(1)}%) for hash ${hash.slice(0, 8)}...`);
        validated.push({
          ...action,
          args: {
            ...action.args,
            ref: relocated.match.ref,
            selector: relocated.match.selector,
            elementHash: computeElementHash(relocated.match)
          }
        });
        continue;
      }
    }

    // Both hash and relocator failed — abort cache
    return {
      ...skill,
      strategy: validated,
      skillReplay: { mode: 'fallback', reason: count === 0 ? 'hash_no_match' : 'hash_ambiguous', hash, matchCount: count }
    };
  }

  return {
    ...skill,
    strategy: validated,
    skillReplay: validated.length ? { mode: 'cache', remaining: validated.length } : { mode: 'fallback', reason: 'empty_plan' }
  };
}

export function attachElementHashToHistoryEntry(entry, observation) {
  if (!entry?.args || entry.elementHash) return entry;
  const elements = observation?.elements || [];
  const ref = entry.args.ref;
  const selector = entry.args.selector;
  let target = null;
  if (ref) target = elements.find(el => el.ref === ref);
  if (!target && selector) target = elements.find(el => el.selector === selector);
  if (!target) return entry;
  return { ...entry, elementHash: target.elementHash || computeElementHash(target) };
}

export async function saveDomainSkill(url, history = [], research = null, aiPage = null, sendMessage = null) {
  const hostname = safeHost(hostnameFromUrl(url));
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  const file = path.join(SKILL_DIR, `${hostname}.json`);
  if (fs.existsSync(file)) return null;

  const actions = history
    .filter(h => h.tool && !['read', 'wait', 'screenshot'].includes(h.tool))
    .map(h => {
      const hash = h.elementHash || actionElementHash(h);
      const args = redactCredentialArgs(h.args || {});

      // Build element fingerprint for adaptive relocation (Scrapling pattern)
      let fingerprint = null;
      if (hash && h.targetElement) {
        fingerprint = elementToFingerprint(h.targetElement);
      }

      if (hash) {
        delete args.selector;
        delete args.ref;
        args.elementHash = hash;
      }
      return {
        tool: h.tool,
        elementHash: hash || null,
        fingerprint,
        sourceStep: h.step,
        args,
        resultSummary: String(h.result || '').slice(0, 120)
      };
    })
    .slice(0, 80);

  const serialized = JSON.stringify(actions).toLowerCase();
  const quirks = [];
  if (/role.*combobox|custom|aria/.test(serialized)) quirks.push('custom_dropdown_handling');
  if (/canvas|signature/.test(serialized)) quirks.push('canvas_signature_pad');
  if (/\+|-|counter|increment|decrement/.test(serialized)) quirks.push('counter_widget_clicks');
  if (actions.some(a => a.elementHash)) quirks.push('hash_based_targets');

  const skill = {
    hostname,
    learnedAt: new Date().toISOString(),
    company: research?.companyName || null,
    role: research?.jobTitle || null,
    strategy: actions,
    quirks
  };
  fs.writeFileSync(file, JSON.stringify(skill, null, 2));

  // Write workflows/<hostname>.yaml companion file
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  const yamlFile = path.join(WORKFLOWS_DIR, `${hostname}.yaml`);
  
  let yamlContent = '';
  if (aiPage && sendMessage) {
    const prompt = `You are a QA automation engineer. Summarize the successful browser form-filling automation below into a clean YAML file for future automation runs.

History of executed steps:
${history.map(h => `- Step ${h.step}: Tool: ${h.tool}, Args: ${JSON.stringify(h.args)}, Reasoning: ${h.reasoning}, Result: ${h.result}`).join('\n')}

Create a YAML document with the following exact keys:
- hostname: "${hostname}"
- learnedAt: "${new Date().toISOString()}"
- quirks:
  - A list of brief plain-language quirks or special behaviors about this application portal (e.g. "submit button requires scrolling to bottom to enable", "react custom dropdown requires typing to filter", "requires signature canvas").
- strategy_summary:
  - A list of plain-language, high-level sequential steps performed to successfully fill the form (e.g. "1. Upload resume on landing page", "2. Click Apply Now", "3. Fill personal details on page 1", "4. Click next and verify success").

Return ONLY raw YAML content. Do not write any markdown code block wraps (like \`\`\`yaml) or explanations.`;
    try {
      const raw = await sendMessage(aiPage, prompt);
      yamlContent = raw.replace(/```yaml\s*/g, '').replace(/```\s*$/g, '').trim();
    } catch (e) {
      console.warn('  [WORKFLOW] Failed to summarize workflow with AI, using fallback.');
    }
  }

  if (!yamlContent) {
    yamlContent = `hostname: "${hostname}"
learnedAt: "${new Date().toISOString()}"
quirks:
${quirks.map(q => `  - "${q}"`).join('\n') || '  - "None"'}
strategy_summary:
${actions.map((a, i) => `  - "Step ${i + 1}: ${a.tool} execution. Reasoning: ${a.args?.reasoning || 'No details'}"`).join('\n') || '  - "No actions performed"'}`;
  }

  fs.writeFileSync(yamlFile, yamlContent);
  return file;
}

export { findElementsByHash, computeElementHash };
