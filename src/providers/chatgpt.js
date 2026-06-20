import { waitForStable } from './index.js';

export const config = {
  key:           'chatgpt',
  name:          'ChatGPT',
  url:           'https://chatgpt.com',
  readySelector: '#prompt-textarea',
};

const RESPONSE = '[data-message-author-role="assistant"]';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;
  const currentUrl = page.url();

  if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/sign-in')) {
    throw new Error(`ChatGPT session has expired (redirected to: ${currentUrl}). Please run /login again.`);
  }

  const popupSelectors = [
    'button:has-text("Stay here")',
    'button:has-text("Dismiss")',
    'button:has-text("OK")',
    'button:has-text("Close")',
    'button:has-text("Got it")',
    'button:has-text("Okay, let\'s go")',
    '[class*="modal"] button',
    '[role="dialog"] button:has-text("Close")',
    '[role="dialog"] button:has-text("Dismiss")',
  ];

  for (const selector of popupSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        const isVisible = await page.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
        }, btn).catch(() => false);

        if (isVisible) {
          await btn.click();
          await new Promise(r => setTimeout(r, 300));
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  try {
    await page.waitForSelector('#prompt-textarea', { visible: true, timeout: 8000 });
  } catch (e) {
    throw new Error(`ChatGPT text area not visible — may be blocked by a modal/CAPTCHA. Error: ${e.message}`);
  }

  const textarea = await page.$('#prompt-textarea');
  try {
    await textarea.click();

    if (text.length > 2000) {
      await page.evaluate((promptText) => {
        const el = document.querySelector('#prompt-textarea');
        if (!el) throw new Error('prompt-textarea not found');

        const p = document.createElement('p');
        p.textContent = promptText;
        el.innerHTML = '';
        el.appendChild(p);

        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);

      await new Promise(r => setTimeout(r, 300));

      const sendBtn = await page.$('button[data-testid="send-button"]');
      const sendVisible = sendBtn ? await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
      }, sendBtn).catch(() => false) : false;

      if (!sendVisible) {
        await textarea.click();
        await page.evaluate(() => {
          const el = document.querySelector('#prompt-textarea');
          if (el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        });
        await page.keyboard.press('Delete');
        await page.keyboard.type(text);
        await new Promise(r => setTimeout(r, 300));
      }
    } else {
      // In Puppeteer, type works by focusing and entering text
      // Clear first
      await page.evaluate(() => {
        const el = document.querySelector('#prompt-textarea');
        if (el) el.innerHTML = '';
      });
      await page.keyboard.type(text);
    }
  } catch (e) {
    throw new Error(`Failed to type prompt into ChatGPT. Error: ${e.message}`);
  }

  try {
    const sendBtn = await page.waitForSelector('button[data-testid="send-button"]', { visible: true, timeout: 5000 });
    await sendBtn.click();
  } catch (e) {
    throw new Error(`Failed to click send button on ChatGPT: ${e.message}`);
  }

  return waitForStable(page, RESPONSE, {
    afterCount:   before,
    stopSelector: 'button[data-testid="stop-button"]',
    stableFor:    500,
  });
}
