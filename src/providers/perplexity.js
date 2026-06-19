import { waitForStable } from './index.js';

// Perplexity's composer may be a <textarea> OR a contenteditable (Lexical) editor
// depending on the build — match both so we don't false-alarm "login expired".
export const config = {
  key:           'perplexity',
  name:          'Perplexity',
  url:           'https://www.perplexity.ai',
  readySelector: 'textarea, div[contenteditable="true"]',
};

// Answer CONTAINER (not .prose p) so we capture the whole answer, not just the last line.
const RESPONSE = '.prose';

export async function sendMessage(page, text) {
  const before = await page.locator(RESPONSE).count();

  // Find whichever input the current build uses.
  const input = page.locator('textarea, div[contenteditable="true"]').first();
  await input.click();

  // keyboard.type() works for both textarea and contenteditable; fill() does not.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Enter');

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 500 });
}
