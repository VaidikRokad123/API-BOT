import { waitForStable } from './index.js';

export const config = {
  key:           'grok',
  name:          'Grok',
  url:           'https://grok.com',
  readySelector: '.ProseMirror',
};

const RESPONSE = '[data-testid="assistant-message"]';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const editor = await page.$('.ProseMirror');
  if (!editor) throw new Error('Grok editor area not found');

  await editor.click();

  // Clear and set ProseMirror content directly using DOM paragraph elements
  await page.evaluate((el, val) => {
    el.innerHTML = '';
    const paragraphs = val.split('\n');
    for (const pText of paragraphs) {
      const p = document.createElement('p');
      p.textContent = pText;
      el.appendChild(p);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, editor, text);

  await new Promise(r => setTimeout(r, 400));

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

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
