import { waitForStable } from './index.js';

// Selectors valid as of 2025-06 — Gemini uses a rich contenteditable editor, not a textarea
export const config = {
  key:           'gemini',
  name:          'Gemini',
  url:           'https://gemini.google.com/app',
  readySelector: 'div[contenteditable="true"]',
};

// Response CONTAINER (not <p>) so we capture the full answer, not just the last line.
const RESPONSE = '.model-response-text';

export async function sendMessage(page, text) {
  const before = await page.locator(RESPONSE).count();

  // Gemini's input is a contenteditable div — fill() works on most builds;
  // keyboard.type() is the fallback if fill() leaves the box empty.
  const input = page.locator('div[contenteditable="true"]').first();
  await input.click();
  await input.fill(text);

  const filled = await input.innerText();
  if (!filled.trim()) {
    await input.selectText();
    await page.keyboard.type(text);
  }

  // Try a send button first; fall back to Enter
  const sendBtn = page.locator(
    'button[aria-label="Send message"], button[data-mat-icon-name="send"], button.send-button'
  );
  if (await sendBtn.count()) {
    await sendBtn.first().click();
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
