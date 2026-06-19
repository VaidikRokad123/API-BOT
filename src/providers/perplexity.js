import { waitForStable } from './index.js';

// Selectors valid as of 2025-06 — update if Perplexity redesigns their UI
export const config = {
  key:           'perplexity',
  name:          'Perplexity',
  url:           'https://www.perplexity.ai',
  readySelector: 'textarea',
};

export async function sendMessage(page, text) {
  const input = page.locator('textarea').first();
  await input.click();
  await input.fill(text);
  await page.keyboard.press('Enter');

  await page.waitForTimeout(1000);

  return waitForStable(page, [
    '.prose p',
    '[class*="answer"] p',
    '[data-testid="answer-header"]',
  ].join(', '), { stableFor: 2000 });
}
