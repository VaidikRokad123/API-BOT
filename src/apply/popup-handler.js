// ─── Popup / New-Window Login Handler (AI-Driven) ─────────────────────────
// Detects login popups/new windows during job applications and uses the same
// AI-driven scrape → ask → execute loop as the main apply flow.
// The AI reads the login page and decides what to fill/click, using the
// credentials from profile.json.

import { scrapePageState } from './scraper.js';
import { executeAction } from './executor.js';
import { sendMessage } from '../ai.js';
import { sanitizeGptJson } from './prompt.js';

const LOGIN_URL_PATTERNS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'linkedin.com/login',
  'linkedin.com/checkpoint',
  'github.com/login',
  'github.com/session',
  'auth0.com',
  'okta.com',
  'signin',
  'sign-in',
  'sign_in',
  'login',
  'oauth',
  '/auth/',
  'sso.',
  'idp.',
  'identity.',
  'accountchooser',
];

/**
 * Check if a URL looks like a login/auth page.
 */
function isLoginUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return LOGIN_URL_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Check if the page is still alive (not closed).
 */
async function isPageAlive(page) {
  try {
    await page.evaluate(() => true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a login-specific prompt for the AI.
 * Includes credentials and instructs the AI to complete the login.
 */
function buildLoginPrompt(pageState, profile, step) {
  // Compress fields like the main prompt does
  const compactFields = pageState.fields.map(f => {
    const compact = { label: f.label, type: f.type, selector: f.selector };
    if (f.required) compact.required = true;
    if (f.placeholder) compact.ph = f.placeholder;
    if (f.type === 'select' && f.options) {
      compact.options = f.options.filter(o => !o.isPlaceholder).map(o => o.text).slice(0, 20);
    }
    if ((f.type === 'checkbox' || f.type === 'radio') && f.checked) compact.checked = true;
    return compact;
  }).slice(0, 40);

  const buttonsToShow = pageState.buttons.filter(b => !b.disabled).slice(0, 15);

  return `
You are an assistant helping to navigate this page (step ${step}). Return ONLY raw JSON — no markdown.

PAGE: ${pageState.url}
Title: ${pageState.title}
Text: ${pageState.pageText?.slice(0, 2000)}

FIELDS (${compactFields.length}):
${JSON.stringify(compactFields)}

BUTTONS: ${JSON.stringify(buttonsToShow.map(b => ({ text: b.text, selector: b.selector })))}

FORMAT:
{"reasoning":"...","actions":[{"type":"fill|select|check|click","selector":"...","value":"...","description":"..."}],"status":"continue|done","message":"..."}

RULES:
- If there is an email, username, or identifier input field: fill it with "__GOOGLE_EMAIL__".
- If there is a password input field: fill it with "__GOOGLE_PASSWORD__".
- If this is a "Choose an account" or selection page: click the account/option matching the user's email address by outputting a click action on the matching element, or search by text matching "__GOOGLE_EMAIL__".
- If this is a verification/confirmation page (e.g. click Continue, Verify, Confirm, Yes, Done, I agree, Allow, etc.): click the appropriate button.
- Only perform ONE logical step per response (e.g. fill email + click Next, OR fill password + click Next, OR click account).
- Set status "continue" if the page is still open and more actions or fields/buttons need interaction.
- Set status "done" only when the login is complete and the page is finished.
- NEVER click Back or Cancel.
`.trim();
}

/**
 * AI-driven login handler. Uses the same scrape → AI → execute loop
 * as the main apply flow, but with a login-specific prompt.
 * Loops until the popup closes or max steps reached.
 */
export async function handlePopupLogin(page, profile, aiPage) {
  let url = '';
  try { url = page.url(); } catch { return true; }

  console.log(`  🔐 Login page detected: ${url.slice(0, 80)}`);

  const MAX_LOGIN_STEPS = 15;
  const LOGIN_TIMEOUT = 120000; // 2 minutes total
  const startTime = Date.now();

  for (let step = 1; step <= MAX_LOGIN_STEPS; step++) {
    // Check if popup is still open
    if (!await isPageAlive(page)) {
      console.log('  ✓ Login page closed — login complete!');
      return true;
    }

    // Check timeout
    if (Date.now() - startTime > LOGIN_TIMEOUT) {
      console.log('  ⚠ Login timeout (2 min) — may need manual intervention');
      return true;
    }

    console.log(`\n    ── Login Step ${step} ──`);

    // Scrape the popup page (same scraper as main apply)
    let pageState;
    try {
      pageState = await scrapePageState(page);
    } catch {
      // Page may have closed during scraping
      if (!await isPageAlive(page)) {
        console.log('  ✓ Login page closed — login complete!');
        return true;
      }
      console.log('    ⚠ Failed to scrape login page');
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    console.log(`    Fields: ${pageState.fields.length} | Buttons: ${pageState.buttons.length}`);

    // Ask AI what to do
    console.log('    🤖 Asking AI about login page...');
    let raw;
    try {
      raw = await sendMessage(aiPage, buildLoginPrompt(pageState, profile, step));
    } catch (e) {
      console.log(`    ⚠ AI error: ${e.message.split('\n')[0]}`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    // Parse AI response
    let agentResp = null;
    try {
      agentResp = sanitizeGptJson(raw);
    } catch {
      console.log('    ⚠ AI returned invalid JSON — retrying...');
      try {
        const retry = await sendMessage(aiPage, 'Your last response had invalid JSON. Re-send ONLY the raw JSON object, no markdown.');
        agentResp = sanitizeGptJson(retry);
      } catch {
        console.log('    ⚠ Still invalid — skipping this step');
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
    }

    if (!agentResp) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    console.log(`    💭 ${agentResp.reasoning}`);
    console.log(`    📋 ${agentResp.actions?.length || 0} action(s) | Status: ${agentResp.status}`);

    // Execute actions on the popup page
    if (agentResp.actions?.length) {
      for (const action of agentResp.actions) {
        // Check if page is still alive before each action
        if (!await isPageAlive(page)) {
          console.log('  ✓ Login page closed during actions — login complete!');
          return true;
        }
        try {
          await executeAction(page, action, profile);
        } catch (e) {
          console.log(`    ⚠ Action failed: ${e.message.split('\n')[0]}`);
        }
      }
    }

    // Wait for page transitions after actions
    await new Promise(r => setTimeout(r, 3000));

    // Check if popup closed after actions
    if (!await isPageAlive(page)) {
      console.log('  ✓ Login page closed — login complete!');
      return true;
    }

    // If AI says done, wait a bit more for popup to close
    if (agentResp.status === 'done') {
      console.log('    ⏳ AI says login done — waiting for login page to close...');
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (!await isPageAlive(page)) {
          console.log('  ✓ Login page closed — login complete!');
          return true;
        }
      }
      // Popup didn't close but AI thinks it's done — continue loop to re-evaluate
      console.log('    → Login page still open — re-evaluating...');
    }
  }

  console.log('  ⚠ Max login steps reached — login page may need manual intervention');
  return true;
}

/**
 * Detect any currently-open login popups/tabs or if the main page itself is a login page,
 * and handle them with AI synchronously.
 * Called at the start of each step in the apply loop.
 * Returns true if a login was handled, or false if no login page is active.
 */
export async function detectAndHandlePopup(browser, mainPage, profile, aiPage) {
  let allPages;
  try {
    allPages = await browser.pages();
  } catch {
    return false;
  }

  // 1. Check for any popup login pages
  for (const page of allPages) {
    if (page === mainPage) continue;

    let url = '';
    try {
      // Wait up to 5 seconds for URL to become non-blank
      for (let i = 0; i < 10; i++) {
        url = page.url();
        if (url && url !== 'about:blank') break;
        await new Promise(r => setTimeout(r, 500));
      }
    } catch {
      continue;
    }

    if (isLoginUrl(url)) {
      console.log(`  [Context Switch] Login popup page open: ${url.slice(0, 80)}`);
      await handlePopupLogin(page, profile, aiPage);
      return true;
    }
  }

  // 2. If no popup login page, check if the main page itself is a login page
  let mainUrl = '';
  try {
    mainUrl = mainPage.url();
  } catch {
    return false;
  }

  if (isLoginUrl(mainUrl)) {
    console.log(`  [Context Switch] Main page is login page: ${mainUrl.slice(0, 80)}`);
    await handlePopupLogin(mainPage, profile, aiPage);
    return true;
  }

  return false;
}
