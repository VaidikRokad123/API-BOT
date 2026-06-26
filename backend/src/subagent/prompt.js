import { TOOL_REGISTRY } from './tools.js';
import { parsePhoneNumber } from '../apply/prompt.js';

function formatActionableFields(fields = []) {
  return fields.slice(0, 60).map(f => {
    const parts = [`ref=${f.ref}`, `role=${f.type === 'select' ? 'combobox' : f.type}`, `name="${f.label}"`];
    if (f.required) parts.push('required');
    if (f.placeholder) parts.push(`ph="${f.placeholder}"`);
    if (f.currentValue) parts.push(`value="${f.currentValue}"`);
    if (f.type === 'select' && f.options?.length) {
      parts.push(`dropdown=native_select options=[${f.options.filter(o => !o.isPlaceholder).map(o => o.text).join(' | ')}]`);
    } else if (f.dropdownKind === 'custom_combobox') {
      parts.push('dropdown=custom_combobox');
    }
    return `- ${parts.join(' | ')}`;
  }).join('\n');
}

function formatButtons(buttons = []) {
  return buttons.slice(0, 40).map(b =>
    `- ref=${b.ref} role=button name="${b.text}"${b.disabled ? ' disabled' : ''}`
  ).join('\n');
}

export function buildSubagentPrompt(task, obs, history = [], profile = null, research = null, domainSkill = null) {
  const toolsInfo = Object.entries(TOOL_REGISTRY).map(([name, def]) => {
    return `- ${name}: ${def.description} | Params: ${JSON.stringify(def.params)}`;
  }).join('\n');

  const historyBlock = history.length ? history.slice(-6).map(h => {
    return `Step ${h.step}:
- Reasoning: ${h.reasoning}
- Tool: ${h.tool}
- Args: ${JSON.stringify(h.args)}
- Result: ${h.result}`;
  }).join('\n\n') : 'No history yet.';

  const elementListBlock = obs.elementList
    ? `\nINTERACTIVE ELEMENTS (authoritative — use ONLY these ref values; never invent a ref or CSS selector):\n${obs.elementList}\n`
    : '';

  const ariaBlock = obs.ariaSnapshot
    ? `\nACCESSIBILITY TREE (reference — act using ref from INTERACTIVE ELEMENTS above):\n${obs.ariaSnapshot.slice(0, 6000)}\n`
    : '';

  const fieldsBlock = formatActionableFields(obs.fields || []);
  const buttonsBlock = formatButtons(obs.buttons || []);

  const consoleBlock = obs.consoleTail?.length
    ? `\nCONSOLE LOGS / ERRORS:\n${obs.consoleTail.join('\n')}\n`
    : '';

  let candidateBlock = '';
  let guidelinesBlock = '';
  const domainSkillBlock = domainSkill
    ? `\nKNOWN DOMAIN SKILL (hash-validated — elementHash targets; 0 or 2+ matches → ignore cache):\n${JSON.stringify(domainSkill).slice(0, 4000)}\n`
    : '';

  if (profile) {
    const [firstName, ...rest] = (profile.name || '').split(' ');
    const lastName = rest.join(' ');
    const parsedPhone = parsePhoneNumber(profile);

    const compactProfile = {
      name: profile.name, firstName, lastName, email: profile.email,
      phone: parsedPhone.phone, phoneCountryCode: parsedPhone.phoneCountryCode,
      phoneNumberDigits: parsedPhone.phoneNumberDigits,
      city: profile.city, state: profile.state, country: profile.country || 'United States',
      linkedin: profile.linkedin, skills: profile.skills,
      yearsOfExperience: profile.yearsOfExperience, expectedCTC: profile.expectedCTC,
      noticePeriod: profile.noticePeriod, workAuthorization: profile.workAuthorization || 'Yes',
      requiresSponsorship: profile.requiresSponsorship || 'No',
      resumeSummary: (profile.resume || '').slice(0, 800)
    };

    let researchText = '';
    if (research) {
      researchText = `\nJOB RESEARCH: ${research.companyName} | ${research.jobTitle}\nMatched: ${research.matchingSkills?.join(', ')}\nSalary: ${research.salaryToQuote ?? research.salaryFallback}\n`;
    }

    candidateBlock = `\nCANDIDATE PROFILE:\n${JSON.stringify(compactProfile)}${researchText}\n`;

    guidelinesBlock = `
GUIDELINES FOR FORM FILLING:
1. INTERACTIVE ELEMENTS list is authoritative. Every fill/click/select MUST use a ref copied exactly from that list. NEVER invent refs, CSS selectors, or element names not shown.
2. Native HTML <select> → use select tool with optionKind "native_select" and value = exact option text from the list.
3. ARIA combobox/listbox/custom dropdown (dropdown=custom_combobox) → use select tool with optionKind "custom_combobox". Do NOT use native_select for these.
4. Use fill_form to batch all visible empty fields before clicking Next/Submit.
5. Google OAuth → handle_login tool. Never type passwords — system fills credentials locally.
6. Submit clicks → args.category="submit_application" (permission gate).
7. status "done"/finish only after explicit submission confirmation text on page.
`;
  } else {
    guidelinesBlock = `
GUIDELINES:
1. Return exactly ONE tool call as raw JSON.
2. Use ONLY ref values from INTERACTIVE ELEMENTS — never invent refs or selectors.
3. Native <select> (dropdown=native_select) vs ARIA custom combobox (dropdown=custom_combobox) require different select optionKind.
4. OAuth/login → handle_login immediately.
5. Read page Text before clicking when task is extract/list/summarize.
6. finish tool puts full deliverable in args.report.
`;
  }

  return `You are a browser subagent executing: "${task}"

TOOLS:
${toolsInfo}
${candidateBlock}
${domainSkillBlock}
${guidelinesBlock}

HISTORY:
${historyBlock}

OBSERVATION:
URL: ${obs.url}
Title: ${obs.title}
Text: ${obs.pageText?.slice(0, 8000)}

ACTIONABLE FIELDS (ref-first):
${fieldsBlock || '(none)'}

BUTTONS:
${buttonsBlock || '(none)'}
${elementListBlock}
${ariaBlock}
${consoleBlock}
FORMAT (raw JSON only):
{"reasoning":"...","tool":"...","args":{...},"status":"continue|done|blocked"}
Use args.ref (preferred) or args.selector ONLY when copied from INTERACTIVE ELEMENTS above.
`;
}
