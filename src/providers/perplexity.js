import { waitForStable } from './index.js';

export const config = {
  key:           'perplexity',
  name:          'Perplexity',
  url:           'https://www.perplexity.ai',
  readySelector: 'textarea, div[contenteditable="true"]',
};

const RESPONSE = '.prose';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const input = await page.$('textarea, div[contenteditable="true"]');
  if (!input) throw new Error('Perplexity input area not found');

  await input.click();

  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Enter');

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
