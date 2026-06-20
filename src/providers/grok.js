import { waitForStable } from './index.js';

export const config = {
  key:           'grok',
  name:          'Grok',
  url:           'https://grok.com',
  readySelector: '.ProseMirror',
};

const RESPONSE = '[data-testid="assistant-message"]';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const editor = await page.$('.ProseMirror');
  if (!editor) throw new Error('Grok editor area not found');

  await editor.click();

  // Clear any leftover content, then type
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 15 });

  // Enter sends in Grok's chat UI
  await page.keyboard.press('Enter');

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
