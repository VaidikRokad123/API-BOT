import { waitForStable } from './index.js';

// DeepSeek web chat — input is a real <textarea id="chat-input">.
// Selectors valid as of 2025-06 — update if DeepSeek redesigns their UI.
export const config = {
  key:           'deepseek',
  name:          'DeepSeek',
  url:           'https://chat.deepseek.com',
  readySelector: 'textarea#chat-input, textarea',
};

// Assistant answers render inside .ds-markdown containers.
const RESPONSE = '.ds-markdown';

export async function sendMessage(page, text) {
  const before = await page.locator(RESPONSE).count();

  const input = page.locator('textarea#chat-input, textarea').first();
  await input.click();
  await input.fill(text);
  await page.keyboard.press('Enter');

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
