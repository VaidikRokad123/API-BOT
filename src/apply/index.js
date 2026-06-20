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
import { handlePopupLogin, detectAndHandlePopup } from './popup-handler.js';

import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function detectCaptcha(page) {
  try {
    return await page.evaluate(() => {
      const selectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="challenge"]',
        '.g-recaptcha',
        '.h-captcha',
        '#cf-challenge-running',
        '#challenge-form'
      ];
      for (const sel of selectors) {
        const elements = Array.from(document.querySelectorAll(sel));
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none') {
            return true;
          }
        }
      }
      return false;
    });
  } catch {
    return false;
  }
}

function pauseForUser(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

export async function apply(jobUrl, visible = true) {
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

  const { browser: aiBrowser, page: aiPage } = await openAiSession(false);

  const appBrowser = await launchBrowser(visible, 'apply');
  const appCtx     = await newStealthContext(appBrowser);
  const appPage    = await appCtx.newPage();



  try {
    await appPage.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const initialPageText = await appPage.evaluate(() => document.body.innerText);

    console.log('  🔍 Analyzing if this is a landing page or the actual application form...');
    const links = await appPage.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.href
      })).filter(l => l.href && l.href.startsWith('http') && l.text.length > 0);
    });

    const linkFinderPrompt = `You are an assistant helping to navigate to a job application form.
We are on the page: ${jobUrl}

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
      await appPage.goto(decision.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log('  ✓ AI identified this page as the active application form.');
    }

    const pageText = await appPage.evaluate(() => document.body.innerText);
    const research = await researchJob(aiPage, appPage.url ? appPage.url() : jobUrl, pageText, profile);

    for (let step = 1; step <= 20; step++) {
      console.log(`\n${'═'.repeat(52)}`);
      console.log(`  STEP ${step}  —  ${new Date().toLocaleTimeString()}`);
      console.log('═'.repeat(52));

      // ─── Login Detection (Main Page or Popup) ───────────────────────────
      // Check for any login popups or new tabs that opened, or if the main page itself is a login page
      let activePage = appPage;
      const loginHandled = await detectAndHandlePopup(appBrowser, appPage, profile, aiPage);
      if (loginHandled) {
        console.log('  ⏳ Login was handled — waiting for auth state to settle (no refresh)...');
        await new Promise(r => setTimeout(r, 6000));
      }

      const pageState = await scrapePageState(activePage);
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
        await activePage.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true }).catch(() => {});
        console.log('\n✅ Application submitted! Screenshot → application_done.png\n');
        break;
      }
      const hasCaptcha = await detectCaptcha(activePage);
      const isCaptchaError = agentResp.status === 'error' && 
        /(captcha|recaptcha|hcaptcha|turnstile|robot|human|verification|challenge)/i.test((agentResp.message || '') + ' ' + (agentResp.reasoning || ''));

      if (hasCaptcha || isCaptchaError) {
        console.log('\n⚠️  [PAUSE] CAPTCHA, verification, or robot check detected!');
        console.log('   Please solve the verification in the browser window.');
        console.log('   Once solved, press ENTER in this terminal to resume...');
        await pauseForUser('   Press ENTER to resume > ');
        step--; // retry this step
        continue;
      }

      if (agentResp.status === 'error') {
        console.log(`\n❌ Agent error: ${agentResp.message}\n`); break;
      }

      if (agentResp.actions?.length) {
        console.log('\n  Executing:');
        for (const action of agentResp.actions) await executeAction(activePage, action, profile);
      }

      const fresh = await scrapePageState(activePage);
      await autoHandleSpecials(activePage, fresh, profile);
    }
  } finally {

    await aiBrowser.close();
    await appBrowser.close();
    console.log('\n[Done] Browsers closed.\n');
  }
}
