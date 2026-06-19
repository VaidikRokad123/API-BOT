import { waitForStable } from './index.js';

export const config = {
  key:           'chatgpt',
  name:          'ChatGPT',
  url:           'https://chatgpt.com',
  readySelector: '#prompt-textarea',
};

export async function sendMessage(page, text) {
  const textarea = page.locator('#prompt-textarea');
  await textarea.click();
  await textarea.fill(text);

  const sendBtn = page.locator('button[data-testid="send-button"]');
  await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
  await sendBtn.click();

  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}

  return waitForStable(page, '.markdown', {
    stopSelector: 'button[data-testid="stop-button"]',
  });
}
