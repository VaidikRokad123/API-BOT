import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openAiSession, sendMessage } from '../ai.js';
import { launchBrowser, newStealthContext } from '../browser.js';
import { PROFILE_FILE } from '../config.js';
import { scrapePageState, installClickListenerTracker } from './scraper.js';
import { buildAgentPrompt, sanitizeGptJson } from './prompt.js';
import { executeAction, autoHandleSpecials } from './executor.js';
import { researchJob } from './research.js';
import { handlePopupLogin, detectAndHandlePopup } from './popup-handler.js';
import { detectCaptcha, pauseForUser } from './captcha.js';
import { isSubmissionConfirmed } from './completion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

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

  const { browser: aiBrowser, page: aiPage } = await openAiSession(false, { engine: options.aiEngine });

  const appBrowser = await launchBrowser(visible, 'apply', { engine: options.browserEngine });
  const appCtx     = await newStealthContext(appBrowser);
  const appPage    = await appCtx.newPage();

  // Hook click listeners BEFORE navigation so custom (React/Vue) buttons are detected.
  await installClickListenerTracker(appPage);

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
    const applicationUrl = appPage.url ? await appPage.url() : jobUrl;
    let research = null;
    if (options.doResearch !== false) {
      console.log('  🔍 Conducting job/company research...');
      research = await researchJob(aiPage, applicationUrl, pageText, profile);
    } else {
      console.log('  ⚡ Skipping job/company research as requested.');
    }

    let emptyActionStreak = 0; // Track consecutive steps with 0 actions

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

      if (isSubmissionConfirmed(pageState)) {
        await activePage.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true }).catch(() => {});
        console.log('\n✅ Application submission confirmed! Screenshot → application_done.png\n');
        break;
      }

      console.log('  🤖 Asking AI...');

      // Wrap AI call with a hard timeout to prevent deadlocks where the AI
      // page goes idle or the stop-button check loops indefinitely.
      const aiTimeout = (promise, ms = 100_000) =>
        Promise.race([promise, new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI_TIMEOUT')), ms)
        )]);

      let raw;
      try {
        raw = await aiTimeout(sendMessage(aiPage, buildAgentPrompt(profile, pageState, step, research)));
      } catch (e) {
        if (e.message === 'AI_TIMEOUT') {
          console.log('  ⚠ AI did not respond in time — retrying this step...');
          // Try clicking stop button to reset AI state
          const stopBtn = await aiPage.$('button[data-testid="stop-button"]').catch(() => null);
          if (stopBtn) await stopBtn.click().catch(() => {});
          await new Promise(r => setTimeout(r, 2000));
          step--; // retry this step
          continue;
        }
        throw e;
      }

      let agentResp = null;
      let src = raw;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          agentResp = sanitizeGptJson(src); break;
        } catch (e) {
          if (attempt === 1) {
            console.log('  ⚠ JSON parse error — asking AI to retry...');
            try {
              src = await aiTimeout(sendMessage(aiPage, 'Your last response had invalid JSON. Re-send ONLY the raw JSON object, no markdown, no explanation.'), 60_000);
            } catch (retryErr) {
              if (retryErr.message === 'AI_TIMEOUT') {
                console.log('  ⚠ AI retry also timed out — skipping to next step');
                break;
              }
              throw retryErr;
            }
          } else {
            console.log(`  ✗ Parse failed: ${e.message}`);
          }
        }
      }

      if (!agentResp) continue;

      console.log(`\n  💭 ${agentResp.reasoning}`);
      console.log(`  📋 ${agentResp.actions?.length || 0} action(s) | Status: ${agentResp.status}`);

      // ─── Find submit button helper (reused below) ─────────────────────
      const findSubmitButton = (btns) => {
        // 1. Exact text match (Submit application, Apply, etc.)
        let submit = btns.find(b =>
          !b.disabled && /^(?:submit|submit\s+application|submit\s+my\s+application|apply\s*(?:now)?|complete|finish|complete\s+application|send\s+application|send|confirm|done|finalize)$/i.test(String(b.text || '').trim().replace(/\s+/g, ' '))
        );
        if (submit) return submit;
        // 2. Partial text match (contains "submit" or "apply")
        submit = btns.find(b =>
          !b.disabled && /\b(?:submit|finalize|complete\s+application)\b/i.test(String(b.text || '').trim())
        );
        if (submit) return submit;
        // 3. data-test-id based (e.g. Microsoft's submitApplicationButton)
        submit = btns.find(b =>
          !b.disabled && /submit/i.test(b.selector)
        );
        return submit || null;
      };

      if (agentResp.status === 'done' && !agentResp.actions?.length) {
        const submit = findSubmitButton(pageState.buttons);
        console.log('  ⚠ AI reported done, but the website has not confirmed submission.');
        agentResp.status = 'continue';
        if (submit) {
          console.log('  → Clicking the real submit button, then validating the form again.');
          agentResp.actions = [{ type: 'click', selector: submit.selector, description: submit.text }];
        }
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
        emptyActionStreak = 0; // Reset streak
        console.log('\n  Executing:');
        for (const action of agentResp.actions) await executeAction(activePage, action, profile);
        // After actions, check if a login popup opened (e.g. after clicking "Sign in with Google")
        const postPopup = await detectAndHandlePopup(appBrowser, appPage, profile, aiPage, true);
        if (postPopup) {
          console.log('  ⏳ Post-action login handled — waiting for auth state to settle (no refresh)...');
          await new Promise(r => setTimeout(r, 4000));
        }
      } else {
        emptyActionStreak++;
        console.log(`  ⚠ AI returned 0 actions (streak: ${emptyActionStreak})`);

        if (emptyActionStreak >= 2) {
          // Scroll down to reveal content that may be below the fold
          console.log('  🔄 Stall detected — scrolling page down to reveal hidden content...');
          await activePage.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
          await new Promise(r => setTimeout(r, 1500));

          // Force-find and click submit button
          const freshState = await scrapePageState(activePage);
          const submit = findSubmitButton(freshState.buttons);
          if (submit) {
            console.log(`  → Found submit button after scroll: "${submit.text}"`);
            await executeAction(activePage, { type: 'click', selector: submit.selector, description: submit.text }, profile);
            emptyActionStreak = 0;
          } else {
            // Also try finding by data-test-id directly
            const directSubmit = await activePage.evaluate(() => {
              const candidates = [
                '[data-test-id*="submit" i]', '[data-testid*="submit" i]',
                '[data-automation-id*="submit" i]', 'button[type="submit"]',
              ];
              for (const sel of candidates) {
                const el = document.querySelector(sel);
                if (el) {
                  const style = getComputedStyle(el);
                  const rect = el.getBoundingClientRect();
                  if (style.display !== 'none' && rect.width > 0) {
                    el.scrollIntoView({ block: 'center' });
                    return { text: el.innerText?.trim() || 'Submit', found: true };
                  }
                }
              }
              return { found: false };
            });
            if (directSubmit.found) {
              console.log(`  → Found submit via data-test-id: "${directSubmit.text}"`);
              await activePage.evaluate(() => {
                const sels = ['[data-test-id*="submit" i]', '[data-testid*="submit" i]',
                  '[data-automation-id*="submit" i]', 'button[type="submit"]'];
                for (const sel of sels) {
                  const el = document.querySelector(sel);
                  if (el) { el.click(); return; }
                }
              });
              await new Promise(r => setTimeout(r, 2000));
              emptyActionStreak = 0;
            }
          }
        }
      }

      const fresh = await scrapePageState(activePage);
      if (isSubmissionConfirmed(fresh)) {
        await activePage.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true }).catch(() => {});
        console.log('\n✅ Application submission confirmed! Screenshot → application_done.png\n');
        break;
      }
      await autoHandleSpecials(activePage, fresh, profile);
    }
  } finally {

    await aiBrowser.close();
    await appBrowser.close();
    console.log('\n[Done] Browsers closed.\n');
  }
}
