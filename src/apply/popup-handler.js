// ─── Popup / New-Window Login Handler (AI-Driven + Programmatic Fallback) ──
// Detects login popups/new windows during job applications. For Google logins,
// it programmatically automates the flow to bypass AI safety filters. For
// other providers, it uses the AI-driven scrape → ask → execute loop.

import { scrapePageState } from './scraper.js';
import { executeAction } from './executor.js';
import { sendMessage } from '../ai.js';
import { sanitizeGptJson } from './prompt.js';
import { detectCaptcha, pauseForUser } from './captcha.js';

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
 * Automates Google Login steps programmatically.
 * Returns true if it performed an action or paused for user interaction, false otherwise.
 */
export async function autoHandleGoogleLogin(page, profile) {
  let url = '';
  try {
    url = page.url();
  } catch {
    return false;
  }
  if (!url || !url.includes('accounts.google.com')) return false;

  console.log('    [Auto-Login] Checking Google Sign-In page state...');
  const googleEmail = profile.credentials?.google?.username || profile.email;
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');

  // 1. Verification/2FA challenges — pause immediately, user must solve
  if (/verify it's you|check your|confirm your recovery|enter code|two-step verification|2-step verification/i.test(pageText)) {
    console.log('\n⚠️  [PAUSE] Google Sign-In verification/2FA challenge detected!');
    console.log('   Please solve the challenge in the browser window.');
    console.log('   Once solved, press ENTER in this terminal to resume...');
    await pauseForUser('   Press ENTER to resume > ');
    return true;
  }

  // 2. Account chooser — must run BEFORE email check so we select the account first
  if (/choose an account|select an account|use another account|signed out/i.test(pageText)) {
    const clicked = await page.evaluate((email) => {
      for (const sel of [`[data-email="${email}"]`, `[data-identifier="${email}"]`, `[data-email*="${email}"]`]) {
        const el = document.querySelector(sel);
        if (el) { el.click(); return true; }
      }
      const items = Array.from(document.querySelectorAll('div, span, button, p, li'));
      const match = items.find(el => {
        const txt = (el.innerText || '').trim().toLowerCase();
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return txt === email.toLowerCase() && rect.width > 0 && style.display !== 'none';
      });
      if (match) {
        (match.closest('button, [role="button"], a, li') || match).click();
        return true;
      }
      return false;
    }, googleEmail).catch(() => false);

    if (clicked) {
      console.log(`    [Auto-Login] Clicked Google account: ${googleEmail}`);
      return true;
    }
  }

  // 3. Email input
  const emailInput = await page.$('input[type="email"]').catch(() => null);
  if (emailInput) {
    const visible = await page.evaluate(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && window.getComputedStyle(e).display !== 'none';
    }, emailInput).catch(() => false);
    const val = await page.evaluate(e => e.value, emailInput).catch(() => '');
    if (visible && !val) {
      console.log(`    [Auto-Login] Entering Google email: ${googleEmail}`);
      await emailInput.click().catch(() => {});
      await page.keyboard.type(googleEmail, { delay: 30 });
      await new Promise(r => setTimeout(r, 400));
      // Enter submits reliably; #identifierNext as backup
      await page.keyboard.press('Enter').catch(() => {});
      const nextBtn = await page.$('#identifierNext').catch(() => null);
      if (nextBtn) await nextBtn.click().catch(() => {});
      console.log('    [Auto-Login] Submitted email');
      return true;
    }
  }

  // 4. Password input — type the REAL password from profile (never a token)
  const passwordInput = await page.$('input[type="password"]').catch(() => null);
  if (passwordInput) {
    const visible = await page.evaluate(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && window.getComputedStyle(e).display !== 'none';
    }, passwordInput).catch(() => false);
    const val = await page.evaluate(e => e.value, passwordInput).catch(() => '');
    if (visible && !val) {
      const googlePassword = profile.credentials?.google?.password || '';
      if (!googlePassword) {
        console.log('    ⚠ No Google password in profile.credentials.google.password');
        return false;
      }
      console.log('    [Auto-Login] Entering Google password...');
      await passwordInput.click().catch(() => {});
      await page.keyboard.type(googlePassword, { delay: 30 });
      await new Promise(r => setTimeout(r, 400));
      await page.keyboard.press('Enter').catch(() => {});
      const nextBtn = await page.$('#passwordNext').catch(() => null);
      if (nextBtn) await nextBtn.click().catch(() => {});
      console.log('    [Auto-Login] Submitted password');
      return true;
    }
  }

  // 5. Consent/Confirmation/Continue/Allow buttons — return coords for real mouse click
  const consentCoords = await page.evaluate(() => {
    const words = [/continue/i, /allow/i, /i agree/i, /confirm/i, /yes/i, /accept/i];
    const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
    for (const regex of words) {
      const el = els.find(e => {
        const txt = (e.innerText || '').trim();
        const rect = e.getBoundingClientRect();
        const style = window.getComputedStyle(e);
        return regex.test(txt) && txt.length < 30 && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || '').trim().slice(0, 20) };
      }
    }
    return null;
  }).catch(() => null);

  if (consentCoords) {
    // Real mouse click — Google ignores programmatic DOM clicks on consent pages
    await page.mouse.click(consentCoords.x, consentCoords.y);
    console.log(`    [Auto-Login] Clicked "${consentCoords.text}" (real mouse click)`);
    await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => {});
    return true;
  }

  return false;
}

/**
 * Build a login-specific prompt for the AI.
 */
function buildLoginPrompt(pageState, profile, step) {
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
- If there are options for multiple login providers (e.g. Google, Microsoft, LinkedIn), ALWAYS choose/click the Google login option. Under NO circumstances should you click Microsoft, LinkedIn, or Email login options.
- If you are on accounts.google.com and you see a "Continue" or "Allow" button with NO email/password fields: click it immediately. This is a permissions consent page — clicking these buttons is safe and required.
- NEVER fill email or password on accounts.google.com — the system fills those automatically. On Google auth pages, only click consent/confirm buttons.
- Do NOT set status "done" if there is any verification, confirmation, "Continue", "Allow", or "I agree" page still visible. Only set status "done" when the popup has closed or navigated back to the main application.
- Only perform ONE logical step per response.
- Set status "continue" if the page is still open.
- NEVER click Back or Cancel.
- CRITICAL: In your JSON response, escape double quotes in selectors with backslash or use single quotes (e.g. "[data-testid='btn']").
`.trim();
}

/**
 * Deterministic Google login loop — NO AI, NO placeholder tokens.
 * Drives accounts.google.com purely with real credentials from profile.json
 * (account chooser → email → password → consent), pausing only for 2FA/CAPTCHA.
 * Returns when the popup closes or navigates away from Google.
 */
async function runGoogleLogin(page, profile) {
  console.log('  🔐 Google login — deterministic handler (no AI)');
  const MAX = 20;
  let idle = 0;

  for (let step = 1; step <= MAX; step++) {
    if (!await isPageAlive(page)) {
      console.log('  ✓ Google popup closed — login complete!');
      return true;
    }

    let url = '';
    try { url = page.url(); } catch { return true; }
    if (!url.includes('accounts.google.com')) {
      console.log('  ✓ Left Google domain — login complete!');
      return true;
    }

    // CAPTCHA / robot check → pause for human
    if (await detectCaptcha(page)) {
      console.log('\n⚠️  [PAUSE] CAPTCHA detected on Google login. Solve it in the browser.');
      await pauseForUser('   Press ENTER to resume > ');
      continue;
    }

    let acted = false;
    try {
      acted = await autoHandleGoogleLogin(page, profile);
    } catch (e) {
      console.log(`    ⚠ Google step error: ${e.message.split('\n')[0]}`);
    }

    if (acted) {
      idle = 0;
      await new Promise(r => setTimeout(r, 2500));
    } else {
      // Nothing actionable found — page may still be loading, or waiting on
      // a manual step (2FA). Wait briefly; bail after a few idle rounds.
      idle++;
      if (idle >= 4) {
        console.log('  ⚠ Google login stuck (no actionable element). May need manual help.');
        return true;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('  ⚠ Google login max steps reached.');
  return true;
}

/**
 * Login handler. Google → deterministic loop. Everything else → AI-driven loop.
 */
export async function handlePopupLogin(page, profile, aiPage) {
  let url = '';
  try { url = page.url(); } catch { return true; }

  console.log(`  🔐 Login page detected: ${url.slice(0, 80)}`);

  // Google auth is fully deterministic — never let the AI touch it (token bugs,
  // safety refusals). Real credentials only.
  if (url.includes('accounts.google.com')) {
    return runGoogleLogin(page, profile);
  }

  // Non-Google login (company SSO chooser, Okta, etc.) → AI guides clicks.
  // On a provider-chooser page the AI is told to pick Google; once it lands on
  // accounts.google.com the next loop iteration hands off to runGoogleLogin.
  const MAX_LOGIN_STEPS = 15;
  const LOGIN_TIMEOUT = 120000; // 2 minutes total
  const startTime = Date.now();

  for (let step = 1; step <= MAX_LOGIN_STEPS; step++) {
    if (!await isPageAlive(page)) {
      console.log('  ✓ Login page closed — login complete!');
      return true;
    }

    if (Date.now() - startTime > LOGIN_TIMEOUT) {
      console.log('  ⚠ Login timeout (2 min) — may need manual intervention');
      return true;
    }

    // Hand off the moment we reach Google.
    let currentUrl = '';
    try { currentUrl = page.url(); } catch {}
    if (currentUrl.includes('accounts.google.com')) {
      return runGoogleLogin(page, profile);
    }

    console.log(`\n    ── Login Step ${step} ──`);

    // CAPTCHA check
    if (await detectCaptcha(page)) {
      console.log('\n⚠️  [PAUSE] CAPTCHA or verification challenge detected in the login popup!');
      console.log('   Solve it in the browser, then press ENTER here to resume...');
      await pauseForUser('   Press ENTER to resume > ');
      step--;
      continue;
    }

    // Scrape page
    let pageState;
    try {
      pageState = await scrapePageState(page);
    } catch {
      if (!await isPageAlive(page)) {
        console.log('  ✓ Login page closed — login complete!');
        return true;
      }
      console.log('    ⚠ Failed to scrape login page');
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    console.log(`    Fields: ${pageState.fields.length} | Buttons: ${pageState.buttons.length}`);

    // Ask AI
    console.log('    🤖 Asking AI about login page...');
    let raw;
    try {
      raw = await sendMessage(aiPage, buildLoginPrompt(pageState, profile, step));
    } catch (e) {
      console.log(`    ⚠ AI error: ${e.message.split('\n')[0]}`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    // Parse response
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

    // Execute actions
    if (agentResp.actions?.length) {
      for (const action of agentResp.actions) {
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

    await new Promise(r => setTimeout(r, 3000));

    if (!await isPageAlive(page)) {
      console.log('  ✓ Login page closed — login complete!');
      return true;
    }

    if (agentResp.status === 'done') {
      console.log('    ⏳ AI says login done — waiting for login page to close...');
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (!await isPageAlive(page)) {
          console.log('  ✓ Login page closed — login complete!');
          return true;
        }
      }
      console.log('    → Login page still open — re-evaluating...');
    }
  }

  console.log('  ⚠ Max login steps reached — login page may need manual intervention');
  return true;
}

/**
 * Detect any currently-open login popups/tabs or if the main page itself is a login page,
 * and handle them with AI synchronously.
 * @param {boolean} waitForNew - if true, wait 2.5 s for a freshly-triggered popup to appear
 */
export async function detectAndHandlePopup(browser, mainPage, profile, aiPage, waitForNew = false) {
  if (waitForNew) {
    // Give the browser time to open a popup triggered by the previous click action
    await new Promise(r => setTimeout(r, 2500));
  }

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
      // Wait up to 3 seconds for URL to become non-blank
      for (let i = 0; i < 6; i++) {
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
