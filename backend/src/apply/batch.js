import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { apply } from './index.js';
import { findSuccessfulApplication } from './ledger.js';
import { SUBAGENT_RUNS_DIR } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Clean regex-based YAML parser for jobs list format */
export function parseYaml(content) {
  const lines = content.split(/\r?\n/);
  const result = { jobs: [] };
  let currentJob = null;
  let inWorkflow = false;
  let workflowIndent = 0;

  for (let line of lines) {
    // Handle workflow multiline strings
    if (inWorkflow) {
      const matchIndent = line.match(/^(\s*)/);
      const indent = matchIndent ? matchIndent[1].length : 0;
      if (line.trim() === '') {
        currentJob.workflow += '\n';
        continue;
      }
      if (indent > workflowIndent) {
        currentJob.workflow += (currentJob.workflow ? '\n' : '') + line.slice(workflowIndent);
        continue;
      } else {
        inWorkflow = false;
      }
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check if new list item
    if (trimmed.startsWith('-')) {
      if (currentJob) {
        result.jobs.push(currentJob);
      }
      currentJob = {};
      const rest = trimmed.slice(1).trim();
      if (rest) {
        parseKeyValue(rest, currentJob);
      }
      continue;
    }

    if (currentJob) {
      const match = trimmed.match(/^([a-zA-Z0-9_\-]+)\s*:\s*([\s\S]*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        
        // Strip quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }

        if (key === 'workflow' || key === 'notes') {
          if (val === '|') {
            inWorkflow = true;
            currentJob.workflow = '';
            // Determine indent of next lines
            const nextLine = lines[lines.indexOf(line) + 1];
            if (nextLine) {
              const nextIndentMatch = nextLine.match(/^(\s*)/);
              workflowIndent = nextIndentMatch ? nextIndentMatch[1].length : 0;
            }
          } else {
            currentJob.workflow = val;
          }
        } else if (key === 'url') {
          currentJob.url = val;
        } else if (key === 'name') {
          currentJob.name = val;
        } else if (key === 'engine') {
          currentJob.engine = val;
        } else if (key === 'research') {
          currentJob.research = val === 'true';
        }
      }
    }
  }

  if (currentJob) {
    result.jobs.push(currentJob);
  }

  return result;
}

function parseKeyValue(str, obj) {
  const match = str.match(/^([a-zA-Z0-9_\-]+)\s*:\s*([\s\S]*)$/);
  if (match) {
    const key = match[1];
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'url') obj.url = val;
    else if (key === 'name') obj.name = val;
    else if (key === 'engine') obj.engine = val;
    else if (key === 'research') obj.research = val === 'true';
    else if (key === 'workflow' || key === 'notes') obj.workflow = val;
  }
}

/** Execute batch of jobs sequentially */
export async function runBatch(yamlFilePath, visible = true, options = {}) {
  const resolvedPath = path.resolve(yamlFilePath);
  if (!fs.existsSync(resolvedPath)) {
    console.log(`\n  ❌ File not found: ${yamlFilePath}\n`);
    return;
  }

  console.log(`\n  📄 Reading batch file: ${yamlFilePath}...`);
  const content = fs.readFileSync(resolvedPath, 'utf8');
  let parsed;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    console.log(`\n  ❌ Failed to parse YAML file: ${err.message}\n`);
    return;
  }

  const jobs = parsed.jobs.filter(j => j.url);
  if (jobs.length === 0) {
    console.log('\n  ⚠ No jobs with valid URLs found in the batch file.\n');
    return;
  }

  console.log(`  ✓ Found ${jobs.length} job entries to process.\n`);
  const results = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const batchRunDir = path.join(SUBAGENT_RUNS_DIR, `batch-run-${timestamp}`);
  fs.mkdirSync(batchRunDir, { recursive: true });

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const jobName = job.name || `Job #${i + 1} (${new URL(job.url).hostname})`;
    console.log(`══════════════════════════════════════════════════════`);
    console.log(`  Processing Job ${i + 1}/${jobs.length}: ${jobName}`);
    console.log(`  URL: ${job.url}`);
    console.log(`══════════════════════════════════════════════════════\n`);

    // Check application ledger
    const existing = await findSuccessfulApplication({ url: job.url }).catch(() => null);
    if (existing) {
      console.log(`  ⏭️ Skipped: Already successfully applied in run ${existing.run_id}.\n`);
      results.push({
        name: jobName,
        url: job.url,
        status: 'SKIPPED',
        reason: 'Already successfully applied (ledger check)',
        steps: '—',
        screenshotDir: '—'
      });
      continue;
    }

    try {
      const applyOptions = {
        browserEngine: job.engine || options.browserEngine || 'real-chrome',
        doResearch: job.research !== false,
        jobWorkflow: job.workflow || null,
        aiEngine: options.aiEngine || 'playwright'
      };

      const result = await apply(job.url, visible, applyOptions);
      const passed = result?.verdict?.passed;

      results.push({
        name: jobName,
        url: job.url,
        status: passed ? 'PASS' : 'FAIL',
        reason: result?.verdict?.reason || 'No details provided.',
        steps: result?.verdict?.passed ? 'All Passed' : 'Failed during run',
        screenshotDir: result?.artifactsDir ? path.relative(process.cwd(), result.artifactsDir) : '—'
      });
    } catch (err) {
      console.log(`  ❌ Job failed with exception: ${err.message}\n`);
      results.push({
        name: jobName,
        url: job.url,
        status: 'FAIL',
        reason: `Exception: ${err.message}`,
        steps: 'Error',
        screenshotDir: '—'
      });
    }
  }

  // Print aggregate summary report
  console.log(`\n======================================================`);
  console.log(`                    BATCH SUMMARY REPORT              `);
  console.log(`======================================================`);
  console.log(`Run Time: ${new Date().toLocaleString()}`);
  console.log(`Total: ${jobs.length} | Passed: ${results.filter(r => r.status === 'PASS').length} | Failed: ${results.filter(r => r.status === 'FAIL').length} | Skipped: ${results.filter(r => r.status === 'SKIPPED').length}\n`);

  console.log(`| #   | Job / Story Name | Status | Steps | Screenshots Dir |`);
  console.log(`| --- | --- | --- | --- | --- |`);
  results.forEach((r, idx) => {
    const statusEmoji = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIPPED';
    console.log(`| ${idx + 1} | ${r.name} | ${statusEmoji} | ${r.steps} | ${r.screenshotDir} |`);
  });
  console.log(`======================================================\n`);

  // Save report to file
  const reportPath = path.join(batchRunDir, 'batch_summary.md');
  let reportText = `# Batch Run Summary Report\n\n`;
  reportText += `**Run Date:** ${new Date().toLocaleString()}\n`;
  reportText += `**Total Jobs:** ${jobs.length}\n`;
  reportText += `**Passed:** ${results.filter(r => r.status === 'PASS').length}\n`;
  reportText += `**Failed:** ${results.filter(r => r.status === 'FAIL').length}\n`;
  reportText += `**Skipped:** ${results.filter(r => r.status === 'SKIPPED').length}\n\n`;
  reportText += `## Job Run Details\n\n`;
  reportText += `| # | Job Name | Status | Screenshot Folder | Details |\n`;
  reportText += `| --- | --- | --- | --- | --- |\n`;
  results.forEach((r, idx) => {
    const statusEmoji = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIPPED';
    const screenshotLink = r.screenshotDir !== '—' ? `[Link](${path.relative(batchRunDir, r.screenshotDir)})` : '—';
    reportText += `| ${idx + 1} | ${r.name} | ${statusEmoji} | ${screenshotLink} | ${r.reason} |\n`;
  });
  
  fs.writeFileSync(reportPath, reportText);
  console.log(`  ✓ Aggregated report saved to: ${path.relative(process.cwd(), reportPath)}\n`);
}
