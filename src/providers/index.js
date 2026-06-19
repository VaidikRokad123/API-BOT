import * as chatgpt     from './chatgpt.js';
import * as grok        from './grok.js';
import * as gemini      from './gemini.js';
import * as perplexity  from './perplexity.js';

export const PROVIDERS = { chatgpt, grok, gemini, perplexity };

export function getProvider(key) {
  if (!PROVIDERS[key]) {
    throw new Error(`Unknown provider: "${key}". Valid: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return PROVIDERS[key];
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
      if (await page.locator(selector).count() > afterCount) break;
      await page.waitForTimeout(poll);
    }
  }

  // Phase 2 — wait for the newest element's text to settle.
  let lastText = '', stableMs = 0;
  while (Date.now() - start < maxWait) {
    await page.waitForTimeout(poll);

    if (stopSelector && await page.locator(stopSelector).count() > 0) {
      stableMs = 0; continue;
    }

    const els = page.locator(selector);
    if (!await els.count()) continue;

    const text = await els.last().innerText().catch(() => '');
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
