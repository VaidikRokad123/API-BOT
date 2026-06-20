import { waitForStable } from './index.js';

export const config = {
  key:           'gemini',
  name:          'Gemini',
  url:           'https://gemini.google.com/app',
  readySelector: 'div[contenteditable="true"]',
};

const RESPONSE = '.model-response-text';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const input = await page.$('div[contenteditable="true"]');
  if (!input) throw new Error('Gemini input area not found');

  await input.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.evaluate((t) => document.execCommand('insertText', false, t), text);
  await new Promise(r => setTimeout(r, 500));

  const sendBtn = await page.$('button[aria-label="Send message"], button[data-mat-icon-name="send"], button.send-button');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
