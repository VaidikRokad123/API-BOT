import { waitForStable, insertPrompt } from './index.js';

export const config = {
  key:           'grok',
  name:          'Grok',
  url:           'https://grok.com',
  readySelector: '.ProseMirror',
  maxInputLength: 20000,
};

const RESPONSE = '[data-testid="assistant-message"]';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  await insertPrompt(page, '.ProseMirror', text, { maxLength: config.maxInputLength });

  // Try to find the send/submit button or press Enter
  const sendBtn = await page.evaluateHandle(() => {
    const prs = document.querySelector('.ProseMirror');
    if (!prs) return null;
    const parent = prs.closest('div[class*="input"], form, div[class*="container"]');
    if (!parent) return null;
    return parent.querySelector('button:has(svg), button[class*="send"], button[class*="submit"]') || null;
  });

  const sendBtnEl = sendBtn.asElement();
  if (sendBtnEl) {
    await sendBtnEl.click().catch(() => {});
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 300 });
}
