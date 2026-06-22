import fs from 'fs';
import path from 'path';
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
import { scrapePageState, installClickListenerTracker } from '../apply/scraper.js';
import { autoHandleSpecials } from '../apply/executor.js';
import { detectCaptcha, pauseForUser } from '../apply/captcha.js';
import { isSubmissionConfirmed } from '../apply/completion.js';
import { researchJob } from '../apply/research.js';

export async function runBrowserSubagent(task, options = {}) {
  const visible = options.hidden !== true;
  const maxSteps = options.maxSteps || 25;
  const aiEngine = options.aiEngine || 'playwright';

  let profile = {};
  if (fs.existsSync(PROFILE_FILE)) {
    try {
      profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    } catch (e) {
      console.warn('  ⚠️  Failed to parse profile.json:', e.message);
    }
  }

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║        Browser Subagent Loop           ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`Task: ${task}\n`);

  const run = ArtifactRun.create(task);

  const { browser: aiBrowser, page: aiPage } = await openAiSession(false, { engine: aiEngine });
  const appBrowser = await launchBrowser(visible, 'subagent', { engine: options.engine });
  const appCtx = await newStealthContext(appBrowser);
  const page = await appCtx.newPage();

  const consoleBuffer = attachConsoleCapture(page);

  // Hook click listeners BEFORE navigation so custom (React/Vue) buttons are detected.
  await installClickListenerTracker(page);

  let research = null;
  if (options.jobUrl) {
    console.log(`  Navigating to initial job URL: ${options.jobUrl}`);
    await page.goto(options.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const initialPageText = await page.evaluate(() => document.body.innerText);

    console.log('  🔍 Analyzing if this is a landing page or the actual application form...');
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.href
      })).filter(l => l.href && l.href.startsWith('http') && l.text.length > 0);
    });

    const linkFinderPrompt = `You are an assistant helping to navigate to a job application form.
We are on the page: ${options.jobUrl}

Here is a snippet of text from the page:
${initialPageText.slice(0, 2000)}

Here are some links found on the page (showing text and href):
${links.slice(0, 100).map(l => `- "${l.text}": ${l.href}`).join('\n')}

Identify if this page is already the application form (e.g. it has inputs for name, email, resume upload, etc.), or if we need to click a link to go to the actual application form (e.g. "Apply", "Apply Now", "Apply on Company Site").

Return your response in this exact JSON format:
{
  "isForm": true, // true if this page is already the form, false if we need to click a link
  "targetUrl": "ALREADY_FORM" // "ALREADY_FORM" if this page is the form, or the exact href URL to navigate to
}
Return ONLY the JSON, nothing else.`;

    const rawDecision = await sendMessage(aiPage, linkFinderPrompt);
    let decision = { isForm: true, targetUrl: 'ALREADY_FORM' };
    try {
      decision = sanitizeGptJson(rawDecision);
    } catch (e) {
      // Best effort fallback
    }

    if (!decision.isForm && decision.targetUrl && decision.targetUrl !== 'ALREADY_FORM') {
      console.log(`  ↪ AI identified main application link: ${decision.targetUrl}`);
      console.log('  Navigating to actual application form...');
      await page.goto(decision.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log('  ✓ AI identified this page as the active application form.');
    }

    const pageText = await page.evaluate(() => document.body.innerText);
    const applicationUrl = page.url ? await page.url() : options.jobUrl;
    
    if (options.doResearch !== false) {
      console.log('  🔍 Conducting job/company research...');
      research = await researchJob(aiPage, applicationUrl, pageText, profile);
    } else {
      console.log('  ⚡ Skipping job/company research as requested.');
    }
  }

  const ctx = {
    profile,
    research,
    browser: appBrowser,
    aiPage,
    run,
    step: 1
  };

  const history = [];
  let finishPayload = null;

  try {
    for (let step = 1; step <= maxSteps; step++) {
      ctx.step = step;
      console.log(`\n  --- Step ${step} ---`);

      // CAPTCHA check
      const hasCaptcha = await detectCaptcha(page).catch(() => false);
      if (hasCaptcha) {
        console.log('\n⚠️  [PAUSE] CAPTCHA, verification, or robot check detected!');
        console.log('   Please solve the verification in the browser window.');
        console.log('   Once solved, press ENTER in this terminal to resume...');
        await pauseForUser('   Press ENTER to resume > ');
        step--; // retry this step
        continue;
      }

      // Direct success confirmation check (apply only)
      if (options.isApply) {
        const pageState = await scrapePageState(page).catch(() => null);
        if (pageState && isSubmissionConfirmed(pageState)) {
          await page.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true }).catch(() => {});
          console.log('\n✅ Application submission confirmed! Screenshot → application_done.png\n');
          break;
        }
      }

      // Auto handle specials (apply only)
      if (options.isApply && ctx.profile && Object.keys(ctx.profile).length) {
        const pageState = await scrapePageState(page).catch(() => null);
        if (pageState) {
          await autoHandleSpecials(page, pageState, ctx.profile);
        }
      }

      const observation = await buildObservation(page, consoleBuffer);
      
      // Save screenshot for the step
      await run.saveScreenshot(page, step, 'step');

      // Append fresh logs to trace
      run.appendConsole(consoleBuffer.getBuffer());
      consoleBuffer.clear();

      // Only inject the candidate profile + form-filling guidelines for actual
      // application runs. Generic /browser tasks get the task-neutral prompt.
      const promptProfile = options.isApply ? ctx.profile : null;
      const prompt = buildSubagentPrompt(task, observation, history, promptProfile, ctx.research);
      console.log('  🤖 Prompting subagent brain...');
      
      let raw;
      try {
        raw = await sendMessage(aiPage, prompt);
      } catch (e) {
        console.error('  ⚠ AI communication error:', e.message);
        break;
      }

      let action = null;
      try {
        action = sanitizeGptJson(raw);
      } catch (e) {
        console.log('  ⚠ JSON parsing failed, asking AI to retry...');
        try {
          const retry = await sendMessage(aiPage, 'Your last response had invalid JSON. Re-send ONLY the raw JSON object, no markdown, no explanation.');
          action = sanitizeGptJson(retry);
        } catch (err) {
          console.error('  ✗ Parse failed:', err.message);
          break;
        }
      }

      if (!action) continue;

      console.log(`  💭 Thought: ${action.reasoning}`);
      console.log(`  📋 Action: ${action.tool} (status: ${action.status})`);

      if (action.tool === 'finish' || action.status === 'done') {
        // Capture the agent's compiled answer/report so it survives into the
        // verdict + report (extraction/report tasks live or die on this).
        finishPayload = action.args || {};
        console.log('  ✓ Task marked completed by subagent.');
        break;
      }

      const tool = TOOL_REGISTRY[action.tool];
      if (!tool) {
        console.warn(`  ⚠ Unknown tool: ${action.tool}`);
        history.push({
          step,
          tool: action.tool,
          args: action.args,
          result: `Unknown tool: ${action.tool}`,
          reasoning: action.reasoning
        });
        continue;
      }

      let result;
      try {
        result = await tool.run(page, action.args || {}, ctx);
        console.log(`  → Result: ${result}`);
      } catch (err) {
        result = `Tool failed: ${err.message}`;
        console.error(`  ✗ ${result}`);
      }

      history.push({
        step,
        tool: action.tool,
        args: action.args || {},
        result,
        reasoning: action.reasoning
      });

      run.writeStepTrace(step, action, observation, result);

      // wait settled
      await new Promise(r => setTimeout(r, 1000));
    }

    const agentReport = finishPayload
      ? (finishPayload.report || finishPayload.result || finishPayload.summary || finishPayload.answer || '')
      : '';

    const verdict = await verifyGoal(page, task, aiPage, consoleBuffer, agentReport);
    console.log(`\n========================================`);
    console.log(`  VERDICT: ${verdict.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`  Reason: ${verdict.reason}`);
    if (agentReport) {
      console.log(`\n  📄 Subagent answer:\n${String(agentReport).slice(0, 1200)}`);
    }
    console.log(`========================================`);

    run.writeReport(history, verdict, agentReport);

    return {
      runId: run.runId,
      verdict,
      artifactsDir: run.runDir
    };

  } finally {
    await aiBrowser.close().catch(() => {});
    await appBrowser.close().catch(() => {});
    console.log(`\n[Done] Subagent run completed. Report written to: ${run.reportPath}\n`);
  }
}
