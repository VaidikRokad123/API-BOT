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
//
// Deadlock protections:
//   - Phase 1 has its own timeout (30s). If no new message appears but the
//     stop button is also gone, we fall through to Phase 2 anyway (the AI may
//     have responded instantly before the count check).
//   - Phase 2 caps stop-button resets: after 40 consecutive resets (~16s at
//     400ms poll) we ignore the stop button and let stability win.
export async function waitForStable(page, selector, {
  poll         = 400,
  stableFor    = 1200,
  maxWait      = 90_000,
  stopSelector = null,
  afterCount   = null,
} = {}) {
  const start = Date.now();

  // Phase 1 — ensure the response for THIS message has actually appeared.
  if (afterCount !== null) {
    const phase1Deadline = Math.min(start + 30_000, start + maxWait * 0.4);
    let sawStopButton = false;
    while (Date.now() < phase1Deadline) {
      const count = (await page.$$(selector)).length;
      if (count > afterCount) break;

      // Check if the AI is still actively generating
      if (stopSelector) {
        const stopVisible = (await page.$$(stopSelector)).length > 0;
        if (stopVisible) {
          sawStopButton = true;
        } else if (sawStopButton) {
          // Stop button appeared then disappeared — AI finished but count
          // didn't increase (race). Break out and let Phase 2 read whatever
          // is there.
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, poll));
    }

    // If we timed out in Phase 1, check if there IS a response element we
    // can read (the count might have raced with our initial snapshot).
    const currentCount = (await page.$$(selector)).length;
    if (currentCount <= afterCount && currentCount === 0) {
      throw new Error(`AI did not produce a response (no response elements found after 30s)`);
    }
    // Otherwise fall through — Phase 2 will read the last element.
  }

  // Phase 2 — wait for the newest element's text to settle.
  let lastText = '', stableMs = 0;
  let stopButtonResets = 0;
  const maxStopResets = 40; // ~16s at 400ms poll — after this, ignore stop button

  while (Date.now() - start < maxWait) {
    await new Promise(resolve => setTimeout(resolve, poll));

    if (stopSelector && stopButtonResets < maxStopResets) {
      const stopCount = (await page.$$(stopSelector)).length;
      if (stopCount > 0) {
        stableMs = 0;
        stopButtonResets++;
        if (stopButtonResets >= maxStopResets) {
          console.log('  ⚠ AI stop button stuck — ignoring it to prevent deadlock');
        }
        continue;
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

  // Last-resort: if we have ANY text, return it instead of crashing
  if (lastText?.trim()) {
    console.log('  ⚠ AI response timed out but returning partial text');
    return lastText.trim();
  }
  throw new Error(`Timed out waiting for AI response (selector: ${selector})`);
}
