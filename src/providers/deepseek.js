import { waitForStable } from './index.js';

export const config = {
  key:           'deepseek',
  name:          'DeepSeek',
  url:           'https://chat.deepseek.com',
  readySelector: 'textarea#chat-input, textarea',
};

const RESPONSE = '.ds-markdown';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const input = await page.$('textarea#chat-input, textarea');
  if (!input) throw new Error('DeepSeek input area not found');

  await input.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.evaluate((t) => document.execCommand('insertText', false, t), text);
  await new Promise(r => setTimeout(r, 500));
  
  // Find the submit/send button next to the input area
  const sendBtn = await page.evaluateHandle(() => {
    const txtArea = document.querySelector('textarea#chat-input, textarea');
    if (!txtArea) return null;
    const parent = txtArea.parentElement;
    if (!parent) return null;
    return parent.querySelector('button, [role="button"], [class*="send"], [class*="submit"]') || null;
  });

  const sendBtnEl = sendBtn.asElement();
  if (sendBtnEl) {
    const isClickable = await page.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
    }, sendBtnEl).catch(() => false);
    
    if (isClickable) {
      await sendBtnEl.click();
    } else {
      await page.keyboard.press('Enter');
    }
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
