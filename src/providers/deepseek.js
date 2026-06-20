import { waitForStable } from './index.js';

export const config = {
  key:           'deepseek',
  name:          'DeepSeek',
  url:           'https://chat.deepseek.com',
  readySelector: 'textarea#chat-input, textarea',
};

const RESPONSE = '.ds-markdown';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  const input = await page.$('textarea#chat-input, textarea');
  if (!input) throw new Error('DeepSeek input area not found');

  await input.click();
  await page.evaluate(el => { el.value = ''; }, input);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
