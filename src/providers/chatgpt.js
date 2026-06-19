import { waitForStable } from './index.js';

export const config = {
  key:           'chatgpt',
  name:          'ChatGPT',
  url:           'https://chatgpt.com',
  readySelector: '#prompt-textarea',
};

// One container per assistant turn — holds the full response text.
const RESPONSE = '[data-message-author-role="assistant"]';

export async function sendMessage(page, text) {
  const before = await page.locator(RESPONSE).count();

  const textarea = page.locator('#prompt-textarea');
  await textarea.click();
  await textarea.fill(text);

  const sendBtn = page.locator('button[data-testid="send-button"]');
  await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
  await sendBtn.click();

  return waitForStable(page, RESPONSE, {
    afterCount:   before,
    stopSelector: 'button[data-testid="stop-button"]',
    stableFor:    500,
  });
}
