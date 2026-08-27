import { waitForStable, insertPrompt } from './index.js';
import { solveAntiBotChallenge } from '../stealth.js';

export const config = {
  key:           'gemini',
  name:          'Gemini',
  url:           'https://gemini.google.com/app',
  readySelector: 'div[contenteditable="true"]',
  maxInputLength: 20000,
};

const RESPONSE = '.model-response-text';

export async function sendMessage(page, text) {
  const before = (await page.$$(RESPONSE)).length;

  await solveAntiBotChallenge(page, { maxWaitMs: 5000 }).catch(() => {});
  await insertPrompt(page, 'div[contenteditable="true"]', text, { maxLength: config.maxInputLength });

  const sendBtn = await page.$('button[aria-label="Send message"], button[data-mat-icon-name="send"], button.send-button');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  return waitForStable(page, RESPONSE, { afterCount: before, stableFor: 300 });
}
