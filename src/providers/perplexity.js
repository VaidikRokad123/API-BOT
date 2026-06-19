import { waitForStable } from './index.js';

// Selectors valid as of 2025-06 — update if Perplexity redesigns their UI
export const config = {
  key:           'perplexity',
  name:          'Perplexity',
  url:           'https://www.perplexity.ai',
  readySelector: 'textarea',
};

// Answer CONTAINER (not .prose p) so we capture the whole answer, not just the last line.
const RESPONSE = '.prose';

export async function sendMessage(page, text) {
  const before = await page.locator(RESPONSE).count();

  const input = page.locator('textarea').first();
  await input.click();
  await input.fill(text);
  await page.keyboard.press('Enter');

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 1500 });
}
