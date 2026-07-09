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

// MutationObserver-based DOM settle wait. Waits until DOM mutations stop
// for `quietMs` or until `timeoutMs` cap is reached. Prevents false read-back
// results from React/framework re-renders that briefly clear or rewrite text.
export async function waitForDomSettle(page, { quietMs = 200, timeoutMs = 2000 } = {}) {
  return page.evaluate(({ quiet, cap }) => new Promise(resolve => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve(true);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, quiet);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    schedule();
    setTimeout(finish, cap);
  }), { quiet: quietMs, cap: timeoutMs }).catch(() => new Promise(resolve => setTimeout(resolve, quietMs)));
}

// Smart prompt truncation for web UI input limits. Preserves the beginning
// (task description, tools, instructions) and the end (format spec, guidelines)
// of the prompt, cutting middle content (page text, element lists, ariaSnapshot).
function truncatePrompt(text, maxLength) {
  if (!maxLength || text.length <= maxLength) return text;

  // Keep ~60% from the start (task, tools, profile, instructions) and ~20% from the end (format spec)
  const headRatio = 0.60;
  const tailRatio = 0.20;
  const marker = '\n\n[... CONTENT TRUNCATED — prompt exceeded input limit, middle sections removed ...]\n\n';

  const headLen = Math.floor((maxLength - marker.length) * headRatio);
  const tailLen = Math.floor((maxLength - marker.length) * tailRatio);

  if (headLen < 200 || tailLen < 100) {
    // If the limit is extremely tight, just hard truncate
    return text.slice(0, maxLength - 50) + '\n[TRUNCATED]';
  }

  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);

  console.warn(`[WARN] Prompt truncated: ${text.length} → ${headLen + marker.length + tailLen} chars (limit: ${maxLength})`);
  return head + marker + tail;
}

// Reliably insert a full prompt into a focused input (textarea or contenteditable).
// Uses execCommand('insertText') — atomic and registered by React/ProseMirror as
// real user input. Verifies the text landed; falls back to keyboard.type with
// newlines neutralised (so a stray \n never triggers premature submit).
//
// Options:
//   maxLength — truncate prompt before insertion if it exceeds this char count.
//               Each provider passes its own limit via config.maxInputLength.
export async function insertPrompt(page, selector, text, { maxLength = 20000 } = {}) {
  const truncated = truncatePrompt(text, maxLength);

  const el = await page.$(selector);
  if (!el) throw new Error(`Input not found: ${selector}`);
  await el.click();

  // Select-all then replace
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.evaluate((t) => document.execCommand('insertText', false, t), truncated);

  // Wait for DOM to settle (MutationObserver-based, not fixed timeout)
  // to let React/framework re-renders flush before read-back verification
  await waitForDomSettle(page, { quietMs: 250, timeoutMs: 3000 });

  // Verify the prompt actually landed
  const got = await page.evaluate(s => {
    const e = document.querySelector(s);
    if (!e) return '';
    return (e.value !== undefined && e.value !== '') ? e.value : (e.innerText || '');
  }, selector).catch(() => '');

  if (got.replace(/\s/g, '').length < truncated.replace(/\s/g, '').length * 0.5) {
    // Fallback: type with newlines turned into spaces to avoid auto-submit
    await el.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(truncated.replace(/\r?\n/g, ' '));
    await waitForDomSettle(page, { quietMs: 250, timeoutMs: 3000 });
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

    // Check for "Continue generating" or "Keep writing" buttons (common in Grok, ChatGPT, etc.)
    const clickedContinue = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const text = btn.innerText.trim().toLowerCase();
        if (text === 'continue generating' || text === 'continue' || text === 'keep writing' || btn.getAttribute('data-testid')?.includes('continue')) {
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);

    if (clickedContinue) {
      console.log('  [STABLE] Detected "Continue generating" button. Clicked to resume generation...');
      stableMs = 0; // Reset stability
      await new Promise(r => setTimeout(r, 1500));
      continue;
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
