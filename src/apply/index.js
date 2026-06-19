import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openAiSession, sendMessage } from '../ai.js';
import { launchBrowser, newStealthContext } from '../browser.js';
import { PROFILE_FILE } from '../config.js';
import { scrapePageState } from './scraper.js';
import { buildAgentPrompt, sanitizeGptJson } from './prompt.js';
import { executeAction, autoHandleSpecials } from './executor.js';
import { researchJob } from './research.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export async function apply(jobUrl, visible = true) {
  if (!fs.existsSync(PROFILE_FILE)) {
    console.error(`✗ Profile not found: ${PROFILE_FILE}`);
    console.error('  Copy data/profile.example.json → data/profile.json and fill in your details.');
    process.exit(1);
  }
  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     Job Application AI Agent           ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`URL     : ${jobUrl}`);
  console.log(`Applying: ${profile.name} <${profile.email}>`);
  console.log(`Resume  : ${profile.resumePdfPath || '⚠ Not set'}\n`);

  const { browser: aiBrowser, page: aiPage } = await openAiSession(false);

  const appBrowser = await launchBrowser(visible);
  const appCtx     = await newStealthContext(appBrowser);
  const appPage    = await appCtx.newPage();

  try {
    await appPage.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await appPage.waitForTimeout(3000);

    const pageText = await appPage.evaluate(() => document.body.innerText);
    const research = await researchJob(aiPage, jobUrl, pageText, profile);

    for (let step = 1; step <= 20; step++) {
      console.log(`\n${'═'.repeat(52)}`);
      console.log(`  STEP ${step}  —  ${new Date().toLocaleTimeString()}`);
      console.log('═'.repeat(52));

      const pageState = await scrapePageState(appPage);
      console.log(`  Fields: ${pageState.fields.length} | Buttons: ${pageState.buttons.length} | Canvases: ${pageState.canvases.length}`);

      console.log('  🤖 Asking AI...');
      const raw = await sendMessage(aiPage, buildAgentPrompt(profile, pageState, step, research));

      let agentResp = null;
      let src = raw;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          agentResp = sanitizeGptJson(src); break;
        } catch (e) {
          if (attempt === 1) {
            console.log('  ⚠ JSON parse error — asking AI to retry...');
            src = await sendMessage(aiPage, 'Your last response had invalid JSON. Re-send ONLY the raw JSON object, no markdown, no explanation.');
          } else {
            console.log(`  ✗ Parse failed: ${e.message}`);
          }
        }
      }

      if (!agentResp) { step++; continue; }

      console.log(`\n  💭 ${agentResp.reasoning}`);
      console.log(`  📋 ${agentResp.actions?.length || 0} action(s) | Status: ${agentResp.status}`);

      if (agentResp.status === 'done') {
        await appPage.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true }).catch(() => {});
        console.log('\n✅ Application submitted! Screenshot → application_done.png\n');
        break;
      }
      if (agentResp.status === 'error') {
        console.log(`\n❌ Agent error: ${agentResp.message}\n`); break;
      }

      if (agentResp.actions?.length) {
        console.log('\n  Executing:');
        for (const action of agentResp.actions) await executeAction(appPage, action, profile);
      }

      const fresh = await scrapePageState(appPage);
      await autoHandleSpecials(appPage, fresh, profile);
    }
  } finally {
    await aiBrowser.close();
    await appBrowser.close();
    console.log('\n[Done] Browsers closed.\n');
  }
}
