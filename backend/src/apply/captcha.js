import readline from 'readline';

// ─── Cloudflare Turnstile Challenge Classifier ──────────────────────────────
// Ported from Scrapling _stealth.py L544-577 + _base.py _detect_cloudflare()

const CF_CHALLENGE_PATTERN = /^https?:\/\/challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\/.*/;

/**
 * Detect the specific type of Cloudflare challenge on the page.
 * Returns: 'non-interactive' | 'managed' | 'interactive' | 'embedded' | null
 */
export async function detectCloudflareType(page) {
  try {
    const html = await page.content().catch(() => '');

    // Check cType markers in page source (Scrapling's exact detection)
    for (const ctype of ['non-interactive', 'managed', 'interactive']) {
      if (html.includes(`cType: '${ctype}'`)) return ctype;
    }

    // Check for embedded Turnstile (script tag inside Shadow iframe)
    const hasEmbedded = await page.evaluate(() => {
      return !!document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v"]');
    }).catch(() => false);
    if (hasEmbedded) return 'embedded';

    return null;
  } catch {
    return null;
  }
}

/**
 * Auto-solve Cloudflare Turnstile challenges.
 * Ported from Scrapling _stealth.py L107-182 (_cloudflare_solver).
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {number} options.maxAttempts - Max solver attempts (default: 3)
 * @param {number} options.timeout - Wait timeout in ms (default: 15000)
 * @returns {boolean} true if solved or no challenge found, false if failed
 */
export async function solveCloudfareTurnstile(page, options = {}) {
  const { maxAttempts = 3, timeout = 15000 } = options;

  try {
    // Wait for network to settle
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const challengeType = await detectCloudflareType(page);
    if (!challengeType) {
      return true; // No challenge present
    }
    console.log(`  [CF-SOLVER] Turnstile type: "${challengeType}"`);

    // Non-interactive: just wait for it to disappear
    if (challengeType === 'non-interactive') {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        const title = await page.title().catch(() => '');
        if (!title.includes('Just a moment')) {
          console.log('  [CF-SOLVER] Non-interactive challenge resolved.');
          return true;
        }
        await page.waitForTimeout(1000);
      }
      console.log('  [CF-SOLVER] Non-interactive challenge did not resolve in time.');
      return false;
    }

    // Interactive / managed / embedded: find and click the checkbox
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const boxSelector = challengeType === 'embedded'
        ? '#cf_turnstile div, #cf-turnstile div, .turnstile>div>div'
        : '.main-content p+div>div>div';

      // For non-embedded: wait for verify spinner to disappear
      if (challengeType !== 'embedded') {
        const verifyStart = Date.now();
        while (Date.now() - verifyStart < 5000) {
          const content = await page.content().catch(() => '');
          if (!content.includes('Verifying you are human.')) break;
          await page.waitForTimeout(500);
        }
      }

      // Try to find the Turnstile iframe
      let outerBox = null;
      const frames = page.frames();
      const cfFrame = frames.find(f => CF_CHALLENGE_PATTERN.test(f.url()));

      if (cfFrame) {
        try {
          await cfFrame.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const frameEl = await cfFrame.frameElement();

          // Wait for iframe to be visible (non-embedded)
          if (challengeType !== 'embedded') {
            const visStart = Date.now();
            while (Date.now() - visStart < 3000) {
              const visible = await frameEl.isVisible().catch(() => false);
              if (visible) break;
              await page.waitForTimeout(500);
            }
          }

          outerBox = await frameEl.boundingBox();
        } catch {
          // Iframe access failed, fall through to locator
        }
      }

      if (!outerBox) {
        // Check if challenge already resolved
        const title = await page.title().catch(() => '');
        if (!title.includes('Just a moment')) {
          console.log('  [CF-SOLVER] Challenge resolved (no iframe found).');
          return true;
        }

        // Fall back to locator-based box detection
        try {
          outerBox = await page.locator(boxSelector).last().boundingBox({ timeout: 3000 });
        } catch {
          console.log(`  [CF-SOLVER] Could not locate Turnstile box (attempt ${attempt + 1}/${maxAttempts}).`);
          await page.waitForTimeout(1000);
          continue;
        }
      }

      if (!outerBox) {
        await page.waitForTimeout(1000);
        continue;
      }

      // Calculate click coordinates (Scrapling's exact offsets: x+26-28, y+25-27)
      const captchaX = outerBox.x + 26 + Math.random() * 3;
      const captchaY = outerBox.y + 25 + Math.random() * 3;

      console.log(`  [CF-SOLVER] Clicking Turnstile at (${Math.round(captchaX)}, ${Math.round(captchaY)})...`);
      await page.mouse.click(captchaX, captchaY, {
        delay: 100 + Math.floor(Math.random() * 100),
        button: 'left',
      });

      // Wait for network idle after click
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      // Wait for "Just a moment" to disappear
      if (challengeType !== 'embedded') {
        const waitStart = Date.now();
        let resolved = false;
        while (Date.now() - waitStart < 10000) {
          const title = await page.title().catch(() => '');
          if (!title.includes('Just a moment')) {
            resolved = true;
            break;
          }
          await page.waitForTimeout(100);
        }
        if (resolved) {
          console.log('  [CF-SOLVER] Turnstile challenge solved!');
          return true;
        }
      } else {
        // Embedded: wait a bit and check
        await page.waitForTimeout(2000);
        const title = await page.title().catch(() => '');
        if (!title.includes('Just a moment')) {
          console.log('  [CF-SOLVER] Embedded Turnstile challenge solved!');
          return true;
        }
      }

      console.log(`  [CF-SOLVER] Challenge persists, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
    }

    console.log('  [CF-SOLVER] Failed to solve Turnstile after all attempts.');
    return false;
  } catch (err) {
    console.error('  [CF-SOLVER] Error:', err.message);
    return false;
  }
}

// ─── Main CAPTCHA detector ──────────────────────────────────────────────────

/**
 * Detect if any visible CAPTCHA or verification challenge is present on the page.
 * If a Cloudflare Turnstile challenge is found, auto-solve it.
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {boolean} options.autoSolve - Auto-solve Turnstile if detected (default: true)
 * @returns {boolean} true if a CAPTCHA is present (and unsolved), false otherwise
 */
export async function detectCaptcha(page, options = {}) {
  const { autoSolve = true } = options;

  try {
    const title = (await page.title().catch(() => '')).toLowerCase();
    const url = (page.url() || '').toLowerCase();
    const html = (await page.content().catch(() => '')).toLowerCase();

    // 1. Check Cloudflare Turnstile
    const isTurnstile = 
      title.includes("just a moment") || 
      title.includes("attention required") || 
      title.includes("checking your browser") ||
      url.includes("cdn-cgi/challenge-platform") || 
      url.includes("/cdn-cgi/challenge") ||
      html.includes("challenges.cloudflare.com/turnstile") || 
      html.includes("cf-turnstile") || 
      html.includes("turnstile.render(");
    
    if (isTurnstile) {
      console.log(`\n  [CAPTCHA] Cloudflare Turnstile challenge detected on page.`);
      if (autoSolve) {
        const solved = await solveCloudfareTurnstile(page);
        if (solved) {
          console.log('  [CAPTCHA] Turnstile auto-solved successfully.');
          return false; // No longer blocking
        }
      }
      return true;
    }

    // 2. Check reCAPTCHA v3
    const isRecaptchaV3 = 
      html.includes("grecaptcha.execute(") ||
      html.includes("grecaptcha.enterprise.execute(") ||
      html.includes("recaptcha/api.js?render=") ||
      html.includes("recaptcha/enterprise.js?render=");

    if (isRecaptchaV3) {
      console.log(`\n  [CAPTCHA] reCAPTCHA v3 challenge detected on page.`);
      return true;
    }

    // 3. Check reCAPTCHA v2
    const isRecaptchaV2 = 
      url.includes("recaptcha") || 
      url.includes("google.com/recaptcha") ||
      html.includes("g-recaptcha") || 
      html.includes("recaptcha-checkbox") || 
      html.includes("api2/anchor") || 
      html.includes("google.com/recaptcha/api.js");

    if (isRecaptchaV2) {
      console.log(`\n  [CAPTCHA] reCAPTCHA v2 challenge detected on page.`);
      return true;
    }

    // 4. Check hCaptcha
    const isHCaptcha = 
      url.includes("hcaptcha") ||
      html.includes("hcaptcha.com/1/api.js") ||
      html.includes("h-captcha") ||
      html.includes("hcaptcha");

    if (isHCaptcha) {
      console.log(`\n  [CAPTCHA] hCaptcha challenge detected on page.`);
      return true;
    }

    // 5. Check Custom JS Integrity Checks
    const hasCustomCheck = 
      ((title.includes("please enable javascript") || title.includes("browser integrity check") || title.includes("access denied") || title.includes("forbidden") || title.includes("blocked")) &&
      (url.includes("challenge") || url.includes("bot") || url.includes("verify"))) ||
      html.includes("__cf_chl") || 
      html.includes("window._cf_chl_opt") || 
      html.includes("challenge-form") || 
      html.includes("jschl") || 
      html.includes("bot challenge") || 
      html.includes("anti-bot") || 
      html.includes("anti bot") || 
      html.includes("please enable javascript") || 
      html.includes("checking your browser before accessing") || 
      html.includes("browser integrity check") || 
      html.includes("navigator.webdriver");

    if (hasCustomCheck) {
      console.log(`\n  [CAPTCHA] Custom JS/Anti-Bot integrity challenge detected.`);
      return true;
    }

    // 6. Generic captcha checks (element-level & text patterns)
    const hasGeneric = await page.evaluate(() => {
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

    if (hasGeneric) {
      console.log(`\n  [CAPTCHA] Generic captcha or verification text detected.`);
      return true;
    }

    return false;
  } catch (err) {
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
