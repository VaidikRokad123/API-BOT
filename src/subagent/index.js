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

  const ctx = {
    profile,
    browser: appBrowser,
    aiPage,
    run,
    step: 1
  };

  const history = [];

  try {
    for (let step = 1; step <= maxSteps; step++) {
      ctx.step = step;
      console.log(`\n  --- Step ${step} ---`);

      const observation = await buildObservation(page, consoleBuffer);
      
      // Save screenshot for the step
      await run.saveScreenshot(page, step, 'step');

      // Append fresh logs to trace
      run.appendConsole(consoleBuffer.getBuffer());
      consoleBuffer.clear();

      const prompt = buildSubagentPrompt(task, observation, history);
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

    const verdict = await verifyGoal(page, task, aiPage, consoleBuffer);
    console.log(`\n========================================`);
    console.log(`  VERDICT: ${verdict.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`  Reason: ${verdict.reason}`);
    console.log(`========================================`);

    run.writeReport(history, verdict);

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
