import { waitForStable } from './index.js';

// Selectors valid as of 2025-06 — update if Grok redesigns their UI
export const config = {
  key:           'grok',
  name:          'Grok',
  url:           'https://grok.com',
  readySelector: 'textarea',
};

export async function sendMessage(page, text) {
  const input = page.locator('textarea').first();
  await input.click();
  await input.fill(text);
  await page.keyboard.press('Enter');

  await page.waitForTimeout(1000);

  // Grok response messages — try multiple selector patterns
  return waitForStable(page, [
    '[data-testid="message"]:last-child',
    '[class*="Message"]:last-child',
    '[class*="response"]:last-child p',
  ].join(', '), { stableFor: 2000 });
}
