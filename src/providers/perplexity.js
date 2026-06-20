import { waitForStable } from './index.js';

export const config = {
  key:           'perplexity',
  name:          'Perplexity',
  url:           'https://www.perplexity.ai',
  readySelector: 'textarea, div[contenteditable="true"]',
};

const RESPONSE = '.prose';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const input = await page.$('textarea, div[contenteditable="true"]');
  if (!input) throw new Error('Perplexity input area not found');

  await input.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.evaluate((t) => document.execCommand('insertText', false, t), text);
  await new Promise(r => setTimeout(r, 500));

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

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
