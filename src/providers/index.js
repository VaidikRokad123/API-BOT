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

// Shared stabilisation helper — polls selector until text stops changing.
export async function waitForStable(page, selector, {
  poll       = 500,
  stableFor  = 1500,
  maxWait    = 120_000,
  stopSelector = null,
} = {}) {
  const start = Date.now();
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
