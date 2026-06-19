import { waitForStable } from './index.js';

// Grok uses a ProseMirror rich-text editor — fill() does not work on it.
// Must click the .ProseMirror div and use keyboard.type().
export const config = {
  key:           'grok',
  name:          'Grok',
  url:           'https://grok.com',
  readySelector: '.ProseMirror',
};

const RESPONSE = '[data-testid="assistant-message"]';

export async function sendMessage(page, text) {
  const before = await page.locator(RESPONSE).count();

  const editor = page.locator('.ProseMirror').first();
  await editor.click();

  // Clear any leftover content, then type
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 15 });

  // Enter sends in Grok's chat UI
  await page.keyboard.press('Enter');

  // afterCount waits for THIS turn's reply to appear — no fixed sleep needed,
  // so a slow "Thought for 2s" no longer makes us read the previous answer.
  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
