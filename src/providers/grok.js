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
  // execCommand insertText updates ProseMirror's internal state correctly (innerHTML doesn't)
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.evaluate((t) => document.execCommand('insertText', false, t), text);
  await new Promise(r => setTimeout(r, 500));

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
