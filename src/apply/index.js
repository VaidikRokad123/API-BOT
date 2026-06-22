import fs from 'fs';
import path from 'path';
import { PROFILE_FILE } from '../config.js';
import { runBrowserSubagent } from '../subagent/index.js';

export async function apply(jobUrl, visible = true, options = {}) {
  if (!fs.existsSync(PROFILE_FILE)) {
    console.error(`✗ Profile not found: ${PROFILE_FILE}`);
    console.error('  Copy data/profile.example.json → data/profile.json and fill in your details.');
    process.exit(1);
  }
  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

  if (profile.resumeLastUpdated && profile.resumePdfLastUpdated) {
    if (profile.resumeLastUpdated !== profile.resumePdfLastUpdated) {
      console.warn('\n  ⚠️  WARNING: Resume version mismatch detected in profile.json!');
      console.warn(`     Plain-text resume last updated: ${profile.resumeLastUpdated}`);
      console.warn(`     PDF resume last updated:        ${profile.resumePdfLastUpdated}`);
      console.warn(`     Ensure your text 'resume' field is in sync with your PDF resume!\n`);
    }
  }

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     Job Application AI Agent           ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`URL     : ${jobUrl}`);
  console.log(`Applying: ${profile.name} <${profile.email}>`);
  console.log(`Resume  : ${profile.resumePdfPath || '⚠ Not set'}\n`);

  const task = `Apply for the job at ${jobUrl} by filling out all required forms and submitting the application using the candidate profile. Ensure you click Next/Continue through all pages and submit the final form.`;

  return runBrowserSubagent(task, {
    engine: options.browserEngine || 'real-chrome',
    aiEngine: options.aiEngine || 'playwright',
    hidden: !visible,
    isApply: true,
    jobUrl,
    doResearch: options.doResearch !== false,
    maxSteps: 40
  });
}
