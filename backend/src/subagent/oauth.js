import { pauseForUser } from '../apply/captcha.js';
import { resolveCredential } from '../credentials.js';

async function firstVisibleHandle(page, selectors) {
  for (const sel of selectors) {
    const els = await page.$$(sel).catch(() => []);
    for (const el of els) {
      const vis = await page.evaluate(e => {
        const r = e.getBoundingClientRect();
        const s = window.getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      }, el).catch(() => false);
      if (vis) return el;
    }
  }
  return null;
}

/** Deterministic Google OAuth — account chooser + optional password fallback. Secrets never touch AI. */
export async function autoHandleGoogleLogin(page, profile = {}) {
  let url = '';
  try {
    url = page.url();
  } catch {
    return { handled: false, action: null };
  }
  if (!url || !url.includes('accounts.google.com')) return { handled: false, action: null };

  const googleEmail = resolveCredential('google', 'username', profile) || profile.email;
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');

  if (/verify it's you|check your|confirm your recovery|enter code|two-step verification|2-step verification/i.test(pageText)) {
    await pauseForUser('\n[PAUSE] Google 2FA/verification — solve in browser, then press ENTER > ');
    return { handled: true, action: '2fa_pause' };
  }

  if (/choose an account|select an account|use another account|signed out/i.test(pageText)) {
    const clicked = await page.evaluate(email => {
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
    if (clicked) return { handled: true, action: 'account_chooser' };
  }

  const emailInput = await firstVisibleHandle(page, [
    '#identifierId', 'input[name="identifier"]', 'input[type="email"]', 'input[autocomplete="username"]'
  ]);
  if (emailInput) {
    const val = await page.evaluate(e => e.value, emailInput).catch(() => '');
    if (!val && googleEmail) {
      await emailInput.click().catch(() => {});
      await page.keyboard.type(googleEmail, { delay: 30 });
      await page.keyboard.press('Enter').catch(() => {});
      return { handled: true, action: 'email' };
    }
  }

  const passwordInput = await firstVisibleHandle(page, [
    'input[type="password"][name="Passwd"]', 'input[name="Passwd"]',
    'input[type="password"]:not([name="hiddenPassword"])', 'input[type="password"]'
  ]);
  if (passwordInput) {
    const val = await page.evaluate(e => e.value, passwordInput).catch(() => '');
    if (!val) {
      const googlePassword = resolveCredential('google', 'password', profile) || '';
      if (!googlePassword) {
        return { handled: false, action: 'password_missing_use_persistent_profile' };
      }
      await passwordInput.click().catch(() => {});
      await page.keyboard.type(googlePassword, { delay: 30 });
      await page.keyboard.press('Enter').catch(() => {});
      return { handled: true, action: 'password' };
    }
  }

  const consentCoords = await page.evaluate(() => {
    const words = [/continue/i, /allow/i, /i agree/i, /confirm/i, /yes/i, /accept/i];
    const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
    for (const regex of words) {
      const el = els.find(e => {
        const txt = (e.innerText || '').trim();
        const rect = e.getBoundingClientRect();
        const style = window.getComputedStyle(e);
        return regex.test(txt) && txt.length < 30 && rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }).catch(() => null);

  if (consentCoords) {
    await page.mouse.click(consentCoords.x, consentCoords.y);
    return { handled: true, action: 'consent' };
  }

  return { handled: false, action: null };
}

export async function handleOAuthPages(pages, profile = {}) {
  for (const candidate of pages) {
    const url = typeof candidate.url === 'function' ? candidate.url() : '';
    if (!url || !/accounts\.google|login|oauth|signin|sso/i.test(url)) continue;
    if (url.includes('accounts.google.com')) {
      const result = await autoHandleGoogleLogin(candidate, profile);
      if (result.handled) return result;
    }
  }
  return { handled: false, action: null };
}
