import fs from 'fs';
import { openAiSession, sendMessage } from '../ai.js';
import { launchBrowser, newStealthContext } from '../browser.js';
import { PROFILE_FILE } from '../config.js';
import { attachConsoleCapture } from './console.js';
import { ArtifactRun } from './artifacts.js';
import { buildObservation } from './perception.js';
import { buildSubagentPrompt } from './prompt.js';
import { TOOL_REGISTRY } from './tools.js';
import { verifyGoal } from './verify.js';
import { sanitizeGptJson } from '../apply/prompt.js';
import { detectCaptcha, pauseForUser } from '../apply/captcha.js';
import { isSubmissionConfirmed } from '../apply/completion.js';
import { researchJob } from '../apply/research.js';
import { validateAiAction } from '../apply/browser-subagent.js';
import { verdictWithFailureReason } from '../apply/failure-taxonomy.js';
import { createSubagentFsm } from './fsm.js';
import { createRunLogger } from './logger.js';
import { loadDomainSkill, saveDomainSkill } from './domain-skills.js';

function readPermissions() {
  try {
    return JSON.parse(fs.readFileSync('data/permissions.json', 'utf8'));
  } catch {
    return {};
  }
}

async function parseAndValidateAction(raw, aiPage, logger) {
  try {
    return validateAiAction(sanitizeGptJson(raw));
  } catch (err) {
    logger?.warn?.({ err: err.message }, 'ai_action_invalid_retrying');
    const retry = await sendMessage(
      aiPage,
      `Your previous response was invalid: ${err.message}\nReturn ONLY one JSON object matching the requested tool schema. No markdown.`
    );
    return validateAiAction(sanitizeGptJson(retry));
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
  const appBrowser = await launchBrowser(visible, 'subagent', { engine: options.engine });
  const appCtx = await newStealthContext(appBrowser);
  const page = await appCtx.newPage();
  const consoleBuffer = attachConsoleCapture(page);

  let research = null;
  let applicationUrl = options.jobUrl || '';
  const permissions = readPermissions();
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

      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      applicationUrl = pageUrl(page) || options.jobUrl;

      if (options.doResearch !== false) {
        logger.info('research_start');
        research = await researchJob(aiPage, applicationUrl, pageText, profile);
        ctx.research = research;
      } else {
        logger.info('research_skipped');
      }
      fsm.send(options.doResearch === false ? 'SKIP_RESEARCH' : 'RESEARCH_DONE', {
        company: research?.companyName,
        role: research?.jobTitle
      });
    }

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
      if (options.isApply && isSubmissionConfirmed(observation)) {
        fsm.send('SUBMITTED', { step });
        logger.info({ step }, 'submission_confirmed');
        break;
      }

      await run.saveScreenshot(page, step, 'step');
      run.appendConsole(consoleBuffer.getBuffer());
      consoleBuffer.clear();

      const promptProfile = options.isApply ? ctx.profile : null;
      const prompt = buildSubagentPrompt(task, observation, history, promptProfile, ctx.research, domainSkill);
      logger.info({ step }, 'prompt_subagent_brain');

      let action;
      try {
        const raw = await sendMessage(aiPage, prompt);
        action = await parseAndValidateAction(raw, aiPage, logger);
      } catch (e) {
        logger.error({ err: e.message }, 'ai_action_failed');
        fsm.send('FAIL', { reason: e.message });
        break;
      }

      logger.info({ reasoning: action.reasoning, tool: action.tool, status: action.status }, 'ai_action');

      if (action.tool === 'finish' || action.status === 'done') {
        finishPayload = action.args || {};
        fsm.send('FINISH', { step });
        break;
      }

      const tool = TOOL_REGISTRY[action.tool];
      if (!tool) {
        const result = `Unknown tool: ${action.tool}`;
        logger.warn({ tool: action.tool }, 'unknown_tool');
        history.push({ step, tool: action.tool, args: action.args, result, reasoning: action.reasoning });
        run.writeStepTrace(step, action, observation, result);
        continue;
      }

      if (isSubmitAction(action)) fsm.send('SUBMIT_READY', { step, tool: action.tool });
      else if (isFormMutationAction(action)) fsm.send('NEED_MORE_FILL', { step, tool: action.tool });
      else if (action.tool === 'click') fsm.send('REVIEW', { step, tool: action.tool });

      let result;
      try {
        result = await tool.run(page, action.args || {}, ctx);
        logger.info({ result }, 'tool_result');
      } catch (err) {
        result = `Tool failed: ${err.message}`;
        logger.error({ err: err.message, tool: action.tool }, 'tool_failed');
      }

      history.push({
        step,
        tool: action.tool,
        args: action.args || {},
        result,
        reasoning: action.reasoning
      });
      run.writeStepTrace(step, action, observation, result);

      if (isSubmitAction(action)) {
        fsm.send('SUBMITTED', { step });
        break;
      }
      if (fsm.state === 'review') fsm.send('NEED_MORE_FILL', { step });
    }

    const agentReport = finishPayload
      ? (finishPayload.report || finishPayload.result || finishPayload.summary || finishPayload.answer || '')
      : '';

    const verdict = verdictWithFailureReason(await verifyGoal(page, task, aiPage, consoleBuffer, agentReport));
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
