import readline from 'readline';

/**
 * Detect if any visible CAPTCHA or verification challenge is present on the page.
 */
export async function detectCaptcha(page) {
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
