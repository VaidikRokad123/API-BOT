import * as chatgpt     from './chatgpt.js';
import * as grok        from './grok.js';
import * as gemini      from './gemini.js';
import * as perplexity  from './perplexity.js';
import * as deepseek    from './deepseek.js';

export const PROVIDERS = { chatgpt, grok, gemini, perplexity, deepseek };

export function getProvider(key) {
  if (!PROVIDERS[key]) {
    throw new Error(`Unknown provider: "${key}". Valid: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return PROVIDERS[key];
}

// Reliably insert a full prompt into a focused input (textarea or contenteditable).
// Uses execCommand('insertText') — atomic and registered by React/ProseMirror as
// real user input. Verifies the text landed; falls back to keyboard.type with
// newlines neutralised (so a stray \n never triggers premature submit).
export async function insertPrompt(page, selector, text) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Input not found: ${selector}`);
  await el.click();

  // Select-all then replace
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.evaluate((t) => document.execCommand('insertText', false, t), text);
  await new Promise(r => setTimeout(r, 500));

  // Verify the prompt actually landed
  const got = await page.evaluate(s => {
    const e = document.querySelector(s);
    if (!e) return '';
    return (e.value !== undefined && e.value !== '') ? e.value : (e.innerText || '');
  }, selector).catch(() => '');

  if (got.replace(/\s/g, '').length < text.replace(/\s/g, '').length * 0.5) {
    // Fallback: type with newlines turned into spaces to avoid auto-submit
    await el.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text.replace(/\r?\n/g, ' '));
    await new Promise(r => setTimeout(r, 400));
  }
}

// Shared response reader. Two phases:
//   1. (if afterCount set) wait until a NEW response element appears — this is
//      what prevents reading the PREVIOUS turn's answer on multi-turn chats.
//   2. poll the newest element until its text stops changing.
export async function waitForStable(page, selector, {
  poll         = 400,
  stableFor    = 1200,
  maxWait      = 120_000,
  stopSelector = null,
  afterCount   = null,
} = {}) {
  const start = Date.now();

  // Phase 1 — ensure the response for THIS message has actually appeared.
  if (afterCount !== null) {
    while (Date.now() - start < maxWait) {
      const count = (await page.$$(selector)).length;
      if (count > afterCount) break;
      await new Promise(resolve => setTimeout(resolve, poll));
    }
  }

  // Phase 2 — wait for the newest element's text to settle.
  let lastText = '', stableMs = 0;
  while (Date.now() - start < maxWait) {
    await new Promise(resolve => setTimeout(resolve, poll));

    if (stopSelector) {
      const stopCount = (await page.$$(stopSelector)).length;
      if (stopCount > 0) {
        stableMs = 0; continue;
      }
    }

    const els = await page.$$(selector);
    if (!els.length) continue;

    const text = await page.evaluate(el => el.innerText, els[els.length - 1]).catch(() => '');
    if (!text?.trim()) continue;

    if (text === lastText) {
      stableMs += poll;
      if (stableMs >= stableFor) return text.trim();
    } else {
      lastText = text;
      stableMs = 0;
    }
  }
  throw new Error(`Timed out waiting for AI response (selector: ${selector})`);
}
