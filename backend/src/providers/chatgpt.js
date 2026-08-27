import { waitForStable, insertPrompt } from './index.js';

export const config = {
  key:           'chatgpt',
  name:          'ChatGPT',
  url:           'https://chatgpt.com',
  readySelector: '#prompt-textarea',
  maxInputLength: 25000,
};

const RESPONSE = '[data-message-author-role="assistant"]';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;
  const currentUrl = page.url();

  if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/sign-in')) {
    throw new Error(`ChatGPT session has expired (redirected to: ${currentUrl}). Please run /login again.`);
  }

  // Handle any popup blocker dialogs (Got it, Close, etc.)
  const popupTextMatchers = ["stay here", "dismiss", "ok", "close", "got it", "okay, let's go"];
  await page.evaluate((matchers) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      const text = btn.innerText.trim().toLowerCase();
      if (matchers.some(m => text === m || text.includes(m))) {
        const rect = btn.getBoundingClientRect();
        const style = window.getComputedStyle(btn);
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
          btn.click();
        }
      }
    }
  }, popupTextMatchers).catch(() => {});

  // Fallback for standard modal/dialog buttons
  try {
    const dialogBtn = await page.$('[class*="modal"] button, [role="dialog"] button');
    if (dialogBtn) {
      await dialogBtn.click().catch(() => {});
    }
  } catch (e) {
    // Ignored
  }

  try {
    await page.waitForSelector('#prompt-textarea', { visible: true, timeout: 8000 });
  } catch (e) {
    throw new Error(`ChatGPT text area not visible — may be blocked by a modal/CAPTCHA. Error: ${e.message}`);
  }

  try {
    await insertPrompt(page, '#prompt-textarea', text, { maxLength: config.maxInputLength });
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
    stopSelector: 'button[data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"], button:has(svg rect)',
    stableFor:    300,
  });
}
