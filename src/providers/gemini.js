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

  // Clear existing content and type the text
  await page.evaluate(el => { el.innerHTML = ''; }, input);
  await page.keyboard.type(text);

  const filled = await page.evaluate(el => el.innerText, input);
  if (!filled.trim()) {
    await page.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, input);
    await page.keyboard.type(text);
  }

  const sendBtn = await page.$('button[aria-label="Send message"], button[data-mat-icon-name="send"], button.send-button');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
