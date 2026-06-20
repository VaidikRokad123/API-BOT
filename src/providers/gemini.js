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

  // Clear and set innerHTML with paragraphs to handle newlines without triggering Enter keypress events
  await page.evaluate((el, val) => {
    el.innerHTML = '';
    const paragraphs = val.split('\n');
    for (const pText of paragraphs) {
      const p = document.createElement('p');
      p.textContent = pText;
      el.appendChild(p);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, input, text);

  await new Promise(r => setTimeout(r, 400));

  const sendBtn = await page.$('button[aria-label="Send message"], button[data-mat-icon-name="send"], button.send-button');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
