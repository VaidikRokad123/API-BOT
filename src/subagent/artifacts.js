import fs from 'fs';
import path from 'path';

function generateId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).substring(2, 8);
  return `run-${timestamp}-${rand}`;
}

export class ArtifactRun {
  constructor(runId, runDir) {
    this.runId = runId;
    this.runDir = runDir;
    this.consoleLogPath = path.join(runDir, 'console.log');
    this.tracePath = path.join(runDir, 'trace.json');
    this.reportPath = path.join(runDir, 'report.md');
    this.screenshotCount = 0;
    this.traceData = [];

    // Ensure the folder exists
    fs.mkdirSync(runDir, { recursive: true });
  }

  static create(task) {
    const runId = generateId();
    const runDir = path.join(process.cwd(), 'subagent_runs', runId);
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

  writeReport(history, verdict) {
    let report = `# Subagent Run Report - ${this.runId}\n\n`;
    report += `**Verdict:** ${verdict.passed ? '✅ PASSED' : '❌ FAILED'}\n`;
    report += `**Reason:** ${verdict.reason || 'No reason provided.'}\n`;
    if (verdict.evidence) {
      report += `**Evidence:** ${verdict.evidence}\n`;
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
