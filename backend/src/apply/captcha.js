import readline from 'readline';

/**
 * Detect if any visible CAPTCHA or verification challenge is present on the page.
 */
export async function detectCaptcha(page) {
  try {
    return await page.evaluate(() => {
      // 1. Selectors for captcha elements/iframes
      const selectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="challenge"]',
        'iframe[src*="arkose"]',
        '.g-recaptcha',
        '.h-captcha',
        '#cf-challenge-running',
        '#challenge-form',
        '#captcha-container',
        '[class*="captcha"]'
      ];
      for (const sel of selectors) {
        const elements = Array.from(document.querySelectorAll(sel));
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            return true;
          }
        }
      }
      // 2. Text patterns on the page indicating CAPTCHA/human verification
      const bodyText = document.body.innerText;
      const captchaTexts = [
        /please solve the captcha/i,
        /verify you are human/i,
        /confirm you are not a robot/i,
        /security check/i,
        /complete the verification/i,
        /solve the puzzle/i
      ];
      for (const regex of captchaTexts) {
        if (regex.test(bodyText)) {
          return true;
        }
      }
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Pause the process and wait for the user to press ENTER in the terminal.
 */
export function pauseForUser(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}
