import fs from 'fs';
import path from 'path';

import { DATA_DIR, SUBAGENT_RUNS_DIR } from '../config.js';

function generateId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).substring(2, 8);
  return `run-${timestamp}-${rand}`;
}

export class ArtifactRun {
  constructor(runId, runDir) {
    this.runId = runId;
    this.runDir = runDir;
    this.dataRunDir = path.join(DATA_DIR, 'runs', runId);
    this.consoleLogPath = path.join(runDir, 'console.log');
    this.tracePath = path.join(runDir, 'trace.json');
    this.reportPath = path.join(runDir, 'report.md');
    this.stepsPath = path.join(this.dataRunDir, 'steps.json');
    this.screenshotCount = 0;
    this.traceData = [];
    this.stepsData = [];

    // Ensure the folder exists
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(this.dataRunDir, { recursive: true });
  }

  static create(task) {
    const runId = generateId();
    const runDir = path.join(SUBAGENT_RUNS_DIR, runId);
    const run = new ArtifactRun(runId, runDir);
    
    // Write initial task to report
    fs.writeFileSync(run.reportPath, `# Subagent Run Report - ${runId}\n\n**TASK:** ${task}\n\n`);
    return run;
  }

  async saveScreenshot(page, step, label = 'step') {
    this.screenshotCount++;
    const filename = `step-${String(step).padStart(2, '0')}-${label}.png`;
    const fullPath = path.join(this.runDir, filename);
    await page.screenshot({ path: fullPath }).catch(() => {});
    return filename;
  }

  async savePendingActionScreenshot(page, step, action) {
    const filename = `pending-${String(step).padStart(2, '0')}-${action.type || 'action'}.png`;
    const fullPath = path.join(this.dataRunDir, filename);
    await page.screenshot({ path: fullPath, fullPage: true }).catch(() => {});
    return fullPath;
  }

  async writeActionResult(page, step, result) {
    const filename = `action-${String(step).padStart(2, '0')}-${String(this.stepsData.length + 1).padStart(3, '0')}.png`;
    const fullPath = path.join(this.dataRunDir, filename);
    await page.screenshot({ path: fullPath, fullPage: true }).catch(() => {});
    const entry = {
      step,
      screenshot: fullPath,
      ...result
    };
    this.stepsData.push(entry);
    fs.writeFileSync(this.stepsPath, JSON.stringify(this.stepsData, null, 2));
    return entry;
  }

  appendConsole(logs) {
    if (!logs || !logs.length) return;
    const content = logs.map(l => `[${new Date().toISOString()}] ${l}`).join('\n') + '\n';
    fs.appendFileSync(this.consoleLogPath, content);
  }

  writeStepTrace(step, action, observation, result) {
    this.traceData.push({
      step,
      reasoning: action.reasoning || '',
      tool: action.tool || '',
      args: action.args || {},
      status: action.status || 'continue',
      observation: {
        url: observation.url,
        title: observation.title,
        consoleTail: observation.consoleTail || []
      },
      result: result || ''
    });
    fs.writeFileSync(this.tracePath, JSON.stringify(this.traceData, null, 2));
  }

  appendStateTransition(transition) {
    this.traceData.push({
      type: 'state_transition',
      at: new Date().toISOString(),
      ...transition
    });
    fs.writeFileSync(this.tracePath, JSON.stringify(this.traceData, null, 2));
  }

  writeReport(history, verdict, agentReport = '') {
    let report = `# Subagent Run Report - ${this.runId}\n\n`;
    report += `**Verdict:** ${verdict.passed ? '✅ PASSED' : '❌ FAILED'}\n`;
    report += `**Reason:** ${verdict.reason || 'No reason provided.'}\n`;
    if (verdict.evidence) {
      report += `**Evidence:** ${verdict.evidence}\n`;
    }
    if (agentReport) {
      report += `\n---\n\n## Result / Answer\n\n${agentReport}\n`;
    }
    report += `\n---\n\n## Step History\n\n`;

    for (const h of history) {
      report += `### Step ${h.step}: ${h.tool}\n`;
      report += `* **Reasoning:** ${h.reasoning || 'N/A'}\n`;
      report += `* **Arguments:** \`${JSON.stringify(h.args)}\`\n`;
      report += `* **Result:** ${h.result || 'Success'}\n`;
      
      // Link step screenshot if exists
      const screenshotFilename = `step-${String(h.step).padStart(2, '0')}-step.png`;
      if (fs.existsSync(path.join(this.runDir, screenshotFilename))) {
        report += `* **Screenshot:** [View screenshot](${screenshotFilename})\n`;
      }
      report += `\n`;
    }

    fs.writeFileSync(this.reportPath, report);
  }
}
