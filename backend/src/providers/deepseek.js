import { waitForStable, insertPrompt } from './index.js';

export const config = {
  key:           'deepseek',
  name:          'DeepSeek',
  url:           'https://chat.deepseek.com',
  readySelector: 'textarea#chat-input, textarea',
  maxInputLength: 25000,
};

const RESPONSE = '.ds-markdown';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  await insertPrompt(page, 'textarea#chat-input, textarea', text, { maxLength: config.maxInputLength });
  
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

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 300 });
}
