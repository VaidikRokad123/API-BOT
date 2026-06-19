import { waitForStable } from './index.js';

// Grok uses a ProseMirror rich-text editor — fill() does not work on it.
// Must click the .ProseMirror div and use keyboard.type().
export const config = {
  key:           'grok',
  name:          'Grok',
  url:           'https://grok.com',
  readySelector: '.ProseMirror',
};

export async function sendMessage(page, text) {
  const editor = page.locator('.ProseMirror').first();
  await editor.click();

  // Clear any leftover content, then type
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 20 });

  // Enter sends in Grok's chat UI
  await page.keyboard.press('Enter');

  await page.waitForTimeout(1500);

  return waitForStable(page, '[data-testid="assistant-message"]', { stableFor: 600 });
}
