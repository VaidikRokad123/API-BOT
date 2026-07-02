import fs from 'fs';
import { openAiSession, sendMessage } from '../ai.js';
import { launchBrowser, newStealthContext } from '../browser.js';
import { PROFILE_FILE, PERMISSIONS_FILE } from '../config.js';
import { attachConsoleCapture } from './console.js';
import { ArtifactRun } from './artifacts.js';
import { buildObservation } from './perception.js';
import { buildSubagentPrompt } from './prompt.js';
import { TOOL_REGISTRY } from './tools.js';
import { verifyGoal } from './verify.js';
import { parseAndValidateAction, sanitizeGptJson } from './ai-json.js';
import { detectCaptcha, pauseForUser } from '../apply/captcha.js';
import { isSubmissionConfirmed } from '../apply/completion.js';
import { researchJob } from '../apply/research.js';
import { verdictWithFailureReason } from '../apply/failure-taxonomy.js';
import { scrapeJobPage } from '../apply/scraper.js';
import { getCorrectionPrompt } from './ai-json.js';
import { validateAiAction } from './engine.js';
import { createSubagentFsm } from './fsm.js';
import { createRunLogger } from './logger.js';
import { loadDomainSkill, saveDomainSkill, prepareDomainSkillForReplay, attachElementHashToHistoryEntry } from './domain-skills.js';
import { checkDomain, wrapContent, scanContent } from './idpi.js';
import { attachDialogHandlers } from './dialog-handlers.js';
import { installRouteBlocker } from './ad-blocker.js';

/** Unofficial DuckDuckGo HTML web search with JSON Instant Answer fallback */
async function duckDuckGoSearch(query, maxResults = 3) {
  const results = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const html = await response.text();
    
    // Parse DuckDuckGo search result links and snippets using RegExp
    const regex = /<a class="result__snippet"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < maxResults) {
      const href = match[1];
      const snippet = match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      results.push({ url: href, snippet });
    }
  } catch (err) {
    // Fallback to Instant Answer API if HTML scraping fails or is blocked
    try {
      const fallbackUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;
      const fallbackRes = await fetch(fallbackUrl);
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        if (data.AbstractText) {
          results.push({ url: data.AbstractURL || '', snippet: data.AbstractText });
        }
      }
    } catch (fallbackErr) {
      // Ignore fallback failures
    }
  }
  return results;
}

/** Helper to extract query terms from job page title or JSON-LD */
function extractQueryTerms(jobUrl, pageTitle, jsonLdString) {
  let company = '';
  let title = '';

  if (jsonLdString) {
    try {
      const data = JSON.parse(jsonLdString);
      const objects = Array.isArray(data) ? data : [data];
      for (const obj of objects) {
        if (obj['@type'] === 'JobPosting' || obj['type'] === 'JobPosting') {
          if (obj.hiringOrganization?.name) {
            company = obj.hiringOrganization.name;
          }
          if (obj.title) {
            title = obj.title;
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  if (!company && pageTitle) {
    const matchAt = pageTitle.match(/(.+)\s+at\s+(.+)/i);
    const matchHiring = pageTitle.match(/(.+)\s+hiring\s+(.+)/i);
    const matchDash = pageTitle.match(/(.+?)\s*[\-|\|]\s*(.+)/);
    
    if (matchAt) {
      title = matchAt[1].trim();
      company = matchAt[2].trim();
    } else if (matchHiring) {
      company = matchHiring[1].trim();
      title = matchHiring[2].trim();
    } else if (matchDash) {
      title = matchDash[1].trim();
      company = matchDash[2].trim();
    }
  }

  if (!company) {
    try {
      const host = new URL(jobUrl).hostname;
      company = host.replace(/^www\./, '').split('.')[0];
    } catch {
      company = '';
    }
  }

  return { company, title };
}

/** Form Reasoning Pre-pass (inspired by ReasoningNode) */
async function generateReasoningPlan(aiPage, page, observation, profile, research, sendMessage) {
  console.log('\n  🧠 Running form reasoning pass...');
  
  const researchText = research 
    ? `Job: ${research.companyName} | ${research.jobTitle}\nMatched Skills: ${research.matchingSkills?.join(', ')}\nSalary Quote: ${research.salaryToQuote ?? research.salaryFallback}` 
    : '';
  
  const prompt = `
You are preparing to fill a form on a job application page.
Based on the candidate profile and current page elements, create a detailed field-mapping plan for the fields on this page.
Explicitly map the visible elements (with their ref values) to the candidate's profile values or general values.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}
${researchText ? `\nRESEARCH:\n${researchText}` : ''}

PAGE URL: ${observation.url}
PAGE TITLE: ${observation.title}

INTERACTIVE ELEMENTS:
${observation.elementList || 'None'}

ACCESSIBILITY TREE / FORM FIELDS:
${observation.ariaSnapshot ? observation.ariaSnapshot.slice(0, 4000) : 'None'}

PLANNING TASKS:
1. Identify each required or important input/select/textarea/checkbox.
2. Link it to the corresponding field in the Candidate Profile.
   - Example: "Email field [ref=e4] -> profile.email"
   - Example: "First Name field [ref=e5] -> profile.firstName"
   - Example: "Notice Period [ref=e8] -> profile.noticePeriod"
3. Identify standard checkmarks or checkboxes (e.g., terms and conditions, voluntary disclosures) and specify how they should be answered.
4. Note which button (e.g., "Next", "Submit", "Continue") should be clicked AFTER all fields are mapped and filled.

Return the plan as a clean, structured bullet-point list. No markdown JSON blocks, just a readable mapping plan that the agent can read and follow.
`;

  try {
    const rawPlan = await sendMessage(aiPage, prompt);
    console.log('  ✓ Reasoning plan generated successfully.');
    return rawPlan;
  } catch (err) {
    console.log('  ⚠ Reasoning pass failed — continuing without mapping plan');
    return null;
  }
}

const DEFAULT_ALLOWED_DOMAINS = [
  '*.perplexity.ai', 'perplexity.ai',
  '*.chatgpt.com', 'chatgpt.com',
  '*.openai.com', 'openai.com',
  '*.grok.com', 'grok.com',
  '*.x.ai', 'x.ai',
  'localhost', '127.0.0.1'
];

function readPermissions(options = {}) {
  if (options.permissions && typeof options.permissions === 'object') {
    return options.permissions;
  }
  try {
    return JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function isSubmitAction(action) {
  if (action.tool !== 'click') return false;
  if (action.args?.category === 'submit_application') return true;
  const haystack = `${action.args?.selector || ''} ${action.args?.ref || ''}`;
  return /\b(submit|apply|complete|finish)\b/i.test(haystack);
}

function isFormMutationAction(action) {
  return ['fill', 'select', 'check', 'upload', 'signature', 'fill_form'].includes(action.tool);
}

function pageUrl(page) {
  try {
    return typeof page.url === 'function' ? page.url() : '';
  } catch {
    return '';
  }
}

export async function runBrowserSubagent(task, options = {}) {
  const visible = options.hidden !== true;
  const maxSteps = options.maxSteps || 25;
  const aiEngine = options.aiEngine || 'playwright';

  let profile = {};
  if (fs.existsSync(PROFILE_FILE)) {
    try {
      profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    } catch (e) {
      process.stderr.write(`Failed to parse profile.json: ${e.message}\n`);
    }
  }

  const run = ArtifactRun.create(task);
  let logger = await createRunLogger(run.runId, options.isApply ? 'research' : 'fill');
  logger.info({ task, options: { isApply: !!options.isApply, engine: options.engine, aiEngine } }, 'subagent_start');

  const { browser: aiBrowser, page: aiPage } = await openAiSession(false, { engine: aiEngine });
  const appBrowser = await launchBrowser(visible, options.isApply ? 'apply' : 'subagent', {
    engine: options.engine,
    persistentProfile: options.persistentProfile !== false && options.isApply
  });
  const appCtx = await newStealthContext(appBrowser);
  const page = await appCtx.newPage();
  attachDialogHandlers(page);
  // Install ad/tracker blocker to speed up page loads and reduce DOM noise (Scrapling pattern)
  if (options.blockAds !== false) {
    await installRouteBlocker(page, { blockAds: true, blockResources: false }).catch(err => {
      console.warn('  [AD-BLOCKER] Failed to install route blocker:', err.message);
    });
  }
  const consoleBuffer = attachConsoleCapture(page);

  let research = null;
  let applicationUrl = options.jobUrl || '';
  const permissions = readPermissions(options);
  const domainSkill = options.jobUrl ? loadDomainSkill(options.jobUrl) : null;
  const fsm = await createSubagentFsm({ isApply: !!options.isApply, run, logger });

  const ctx = {
    profile,
    research,
    browser: appBrowser,
    aiPage,
    run,
    step: 1,
    permissions,
    logger,
    state: fsm.state
  };

  const history = [];
  let finishPayload = null;

  try {
    if (options.jobUrl) {
      logger.info({ url: options.jobUrl }, 'navigate_initial_job_url');
      await page.goto(options.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      const initialPageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      logger.info('analyze_landing_or_form');
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.innerText.trim(),
          href: a.href
        })).filter(l => l.href && l.href.startsWith('http') && l.text.length > 0);
      }).catch(() => []);

      const linkFinderPrompt = `You are an assistant helping to navigate to a job application form.
We are on the page: ${options.jobUrl}

Here is a snippet of text from the page:
${initialPageText.slice(0, 2000)}

Here are some links found on the page (showing text and href):
${links.slice(0, 100).map(l => `- "${l.text}": ${l.href}`).join('\n')}

Identify if this page is already the application form, or if we need to click a link to go to the actual application form.

Return ONLY this JSON:
{"isForm":true,"targetUrl":"ALREADY_FORM"}`;

      let decision = { isForm: true, targetUrl: 'ALREADY_FORM' };
      try {
        decision = sanitizeGptJson(await sendMessage(aiPage, linkFinderPrompt));
      } catch {
        decision = { isForm: true, targetUrl: 'ALREADY_FORM' };
      }

      if (!decision.isForm && decision.targetUrl && decision.targetUrl !== 'ALREADY_FORM') {
        logger.info({ targetUrl: decision.targetUrl }, 'navigate_application_form');
        await page.goto(decision.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
      } else {
        logger.info('active_application_form');
      }

      applicationUrl = pageUrl(page) || options.jobUrl;

      let researchInput = '';
      if (options.doResearch !== false) {
        logger.info('research_start');
        const scraped = await scrapeJobPage(page).catch(err => {
          logger.warn({ err: err.message }, 'scrape_job_page_failed');
          return null;
        });

        if (scraped) {
          if (scraped.title) {
            researchInput += `Page Title: ${scraped.title}\n\n`;
          }
          if (scraped.jsonLd) {
            researchInput += `JSON-LD Metadata:\n${scraped.jsonLd}\n\n`;
          }
          researchInput += `Cleaned Page Content:\n${scraped.cleanedText}`;
          
          // Perform web search grounding if we have company/role
          const extracted = extractQueryTerms(applicationUrl, scraped.title, scraped.jsonLd);
          if (extracted.company || extracted.title) {
            const searchQuery = `${extracted.company} ${extracted.title} salary range`.trim();
            console.log(`  🌐 Searching web for: "${searchQuery}"`);
            const searchResults = await duckDuckGoSearch(searchQuery, 3);
            if (searchResults && searchResults.length > 0) {
              const searchResultsText = searchResults.map((r, i) => `${i + 1}. Source: ${r.url}\n   Info: ${r.snippet}`).join('\n\n');
              researchInput = `WEB SEARCH GROUNDING (Current context):\n${searchResultsText}\n\n` + researchInput;
              console.log(`  ✓ Found ${searchResults.length} web search results for grounding.`);
            }
          }
        } else {
          researchInput = await page.evaluate(() => document.body.innerText).catch(() => '');
        }

        research = await researchJob(aiPage, applicationUrl, researchInput, profile);
        ctx.research = research;
      } else {
        logger.info('research_skipped');
      }
      fsm.send(options.doResearch === false ? 'SKIP_RESEARCH' : 'RESEARCH_DONE', {
        company: research?.companyName,
        role: research?.jobTitle
      });
    }

    let lastUrlForReasoning = '';
    let reasoningPlan = null;

    for (let step = 1; step <= maxSteps; step++) {
      ctx.step = step;
      logger = await createRunLogger(run.runId, fsm.state);
      ctx.logger = logger;
      ctx.state = fsm.state;
      logger.info({ step, state: fsm.state }, 'subagent_step');

      const hasCaptcha = await detectCaptcha(page).catch(() => false);
      if (hasCaptcha) {
        logger.warn({ step }, 'captcha_detected');
        process.stdout.write('\n[PAUSE] CAPTCHA, verification, or robot check detected. Solve it in the browser, then press ENTER.\n');
        await pauseForUser('   Press ENTER to resume > ');
        step--;
        continue;
      }

      const observation = await buildObservation(page, consoleBuffer);

      // IDPI (Indirect Prompt Injection) Defense & Content Wrapping
      if (options.idpiEnabled !== false) {
        const currentUrl = page.url() || '';
        const allowed = options.allowedDomains || DEFAULT_ALLOWED_DOMAINS;
        const strict = options.idpiStrictMode === true;

        const domainCheck = checkDomain(currentUrl, allowed, strict);
        if (domainCheck.threat) {
          logger.warn({ url: currentUrl, blocked: domainCheck.blocked, reason: domainCheck.reason }, 'idpi_domain_flagged');
          if (domainCheck.blocked) {
            fsm.send('FAIL', { reason: domainCheck.reason });
            break;
          }
        }

        const textCheck = scanContent(observation.pageText, strict);
        if (textCheck.threat) {
          logger.warn({ reason: textCheck.reason, pattern: textCheck.pattern, blocked: textCheck.blocked }, 'idpi_content_flagged');
          if (textCheck.blocked) {
            fsm.send('FAIL', { reason: textCheck.reason });
            break;
          }
        }

        observation.pageText = wrapContent(observation.pageText, currentUrl);
      }

      if (options.isApply && isSubmissionConfirmed(observation)) {
        fsm.send('SUBMITTED', { step });
        logger.info({ step }, 'submission_confirmed');
        break;
      }

      // Generate or update form reasoning plan on page transitions
      if (options.isApply && (step === 1 || page.url() !== lastUrlForReasoning)) {
        lastUrlForReasoning = page.url();
        reasoningPlan = await generateReasoningPlan(aiPage, page, observation, profile, ctx.research, sendMessage);
      }

      await run.saveScreenshot(page, step, 'step');
      run.appendConsole(consoleBuffer.getBuffer());
      consoleBuffer.clear();

      const promptProfile = options.isApply ? ctx.profile : null;
      const replaySkill = domainSkill
        ? prepareDomainSkillForReplay(domainSkill, observation, history)
        : null;

      // 4-Type Error Correction and Step Retry Loop
      let action = null;
      let raw = '';
      let errorType = null;
      let errorObj = null;
      let stepAttempt = 1;
      const maxStepAttempts = 2;
      let stepSuccess = false;

      while (stepAttempt <= maxStepAttempts) {
        try {
          if (stepAttempt === 1) {
            const prompt = buildSubagentPrompt(task, observation, history, promptProfile, ctx.research, replaySkill, reasoningPlan);
            logger.info({ step }, 'prompt_subagent_brain');
            raw = await sendMessage(aiPage, prompt);
          } else {
            const correctionPrompt = await getCorrectionPrompt(errorType, errorObj, raw, action, page);
            logger.warn({ step, attempt: stepAttempt, errorType, err: errorObj.message }, 'sending_error_correction_prompt');
            raw = await sendMessage(aiPage, correctionPrompt);
          }

          // 1 & 2. Parse & validate action (Syntax and Validation errors)
          try {
            action = validateAiAction(sanitizeGptJson(raw));
          } catch (err) {
            errorObj = err;
            errorType = (err.message.includes('JSON') || err.message.includes('parse')) ? 'syntax' : 'validation';
            throw err;
          }

          logger.info({ reasoning: action.reasoning, tool: action.tool, status: action.status }, 'ai_action');

          if (action.tool === 'finish' || action.status === 'done') {
            finishPayload = action.args || {};
            fsm.send('FINISH', { step });
            stepSuccess = true;
            break;
          }

          const tool = TOOL_REGISTRY[action.tool];
          if (!tool) {
            const err = new Error(`Unknown tool: ${action.tool}`);
            errorObj = err;
            errorType = 'validation';
            throw err;
          }

          if (isSubmitAction(action)) fsm.send('SUBMIT_READY', { step, tool: action.tool });
          else if (isFormMutationAction(action)) fsm.send('NEED_MORE_FILL', { step, tool: action.tool });
          else if (action.tool === 'click') fsm.send('REVIEW', { step, tool: action.tool });

          // 3. Execute tool (Execution errors)
          let result;
          try {
            result = await tool.run(page, action.args || {}, ctx);
            logger.info({ result }, 'tool_result');
          } catch (err) {
            errorObj = err;
            errorType = 'execution';
            throw err;
          }

          // 4. Post-execution checks (Semantic errors)
          const hasSemanticError = await page.evaluate(() => {
            const errorElements = Array.from(document.querySelectorAll('.error, .invalid, .warning, [role="alert"], [class*="error" i], [class*="invalid" i], [class*="warning" i]'));
            return errorElements.some(el => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && 
                     style.display !== 'none' && 
                     style.visibility !== 'hidden' && 
                     style.opacity !== '0' &&
                     el.innerText.trim().length > 0;
            });
          }).catch(() => false);

          if (hasSemanticError) {
            errorObj = new Error('Semantic validation error or form warning detected on the page after action execution.');
            errorType = 'semantic';
            throw errorObj;
          }

          // Record successful step history
          history.push(attachElementHashToHistoryEntry({
            step,
            tool: action.tool,
            args: action.args || {},
            result,
            reasoning: action.reasoning
          }, observation));
          run.writeStepTrace(step, action, observation, result);

          if (isSubmitAction(action)) {
            fsm.send('SUBMITTED', { step });
            stepSuccess = true;
            break;
          }
          if (fsm.state === 'review') fsm.send('NEED_MORE_FILL', { step });

          stepSuccess = true;
          break; // Step attempt succeeded, break retry loop

        } catch (stepErr) {
          logger.warn({ step, attempt: stepAttempt, errorType, err: stepErr.message }, 'step_attempt_failed');
          
          if (stepAttempt >= maxStepAttempts) {
            // Failed after all retries
            logger.error({ err: stepErr.message }, 'ai_action_failed');
            fsm.send('FAIL', { reason: stepErr.message });
            break;
          }
          stepAttempt++;
        }
      }

      if (fsm.state === 'fail' || fsm.state === 'finish' || fsm.state === 'submitted') {
        break;
      }
    }

    const agentReport = finishPayload
      ? (finishPayload.report || finishPayload.result || finishPayload.summary || finishPayload.answer || '')
      : '';

    const verdict = verdictWithFailureReason(await verifyGoal(page, task, aiPage, consoleBuffer, agentReport, { isApply: !!options.isApply }));
    logger.info({ verdict, agentReport: String(agentReport || '').slice(0, 1200) }, 'subagent_verdict');

    run.writeReport(history, verdict, agentReport);
    if (options.isApply && verdict.passed) {
      saveDomainSkill(applicationUrl || options.jobUrl, history, research);
    }

    return {
      runId: run.runId,
      verdict,
      artifactsDir: run.runDir,
      dataRunDir: run.dataRunDir,
      research,
      report: agentReport
    };
  } finally {
    await aiBrowser.close().catch(() => {});
    await appBrowser.close().catch(() => {});
    logger.info({ reportPath: run.reportPath, dataRunDir: run.dataRunDir }, 'subagent_done');
  }
}
