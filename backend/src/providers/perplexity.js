import { waitForStable, insertPrompt } from './index.js';

export const config = {
  key:           'perplexity',
  name:          'Perplexity',
  url:           'https://www.perplexity.ai',
  readySelector: 'textarea, div[contenteditable="true"]',
  maxInputLength: 16000,
};

const RESPONSE = '.prose';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  await insertPrompt(page, 'textarea, div[contenteditable="true"]', text, { maxLength: config.maxInputLength });

  // Find the submit/send button in the input area
  const sendBtn = await page.evaluateHandle(() => {
    const container = document.querySelector('textarea, div[contenteditable="true"]')?.closest('form, div[class*="input"]');
    if (!container) return null;
    return container.querySelector('button[type="submit"], button[aria-label*="Submit"], button:has(svg), button[class*="submit"]') || null;
  });

  const sendBtnEl = sendBtn.asElement();
  if (sendBtnEl) {
    await sendBtnEl.click().catch(() => {});
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 3500 });
}
