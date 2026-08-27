import { waitForStable, insertPrompt } from './index.js';
import { solveAntiBotChallenge } from '../stealth.js';

export const config = {
  key:           'chatgpt',
  name:          'ChatGPT',
  url:           'https://chatgpt.com',
  readySelector: '#prompt-textarea, [data-testid="prompt-textarea"], div[contenteditable="true"], textarea[data-id="root"]',
  maxInputLength: 25000,
};

const RESPONSE = '[data-message-author-role="assistant"]';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;
  const currentUrl = page.url ? page.url() : '';

  if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/sign-in')) {
    throw new Error(`ChatGPT session has expired (redirected to: ${currentUrl}). Please run /login again.`);
  }

  // Automatic challenge & popup resolution
  await solveAntiBotChallenge(page, { maxWaitMs: 8000 }).catch(() => {});

  const promptSelector = '#prompt-textarea, [data-testid="prompt-textarea"], div[contenteditable="true"], textarea[data-id="root"]';
  try {
    await page.waitForSelector(promptSelector, { visible: true, timeout: 8000 });
  } catch (e) {
    // Attempt second recovery pass if blocked
    await solveAntiBotChallenge(page, { maxWaitMs: 10000 }).catch(() => {});
    try {
      await page.waitForSelector(promptSelector, { visible: true, timeout: 5000 });
    } catch {
      throw new Error(`ChatGPT text area not visible — may be blocked by a modal/CAPTCHA. Error: ${e.message}`);
    }
  }

  try {
    await insertPrompt(page, promptSelector, text, { maxLength: config.maxInputLength });
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
