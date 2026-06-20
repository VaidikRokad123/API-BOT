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

  // Set the value directly via DOM (handling both textarea and contenteditable with React compatibility)
  await page.evaluate((val) => {
    const el = document.querySelector('textarea, div[contenteditable="true"]');
    if (el) {
      const isEditable = el.getAttribute('contenteditable') === 'true' || el.contentEditable === 'true';
      if (isEditable) {
        el.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = val;
        el.appendChild(p);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const prototype = Object.getPrototypeOf(el);
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (valueSetter) {
          valueSetter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, text);

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
