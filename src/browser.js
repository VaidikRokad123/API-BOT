import { chromium } from 'playwright';

export const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
];

const STEALTH_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function launchBrowser(visible = false) {
  return chromium.launch({
    headless: false,
    args: [...STEALTH_ARGS, ...(visible ? [] : ['--start-minimized'])],
  });
}

export async function newStealthContext(browser, storageState = null) {
  const opts = {
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
  };
  if (storageState) opts.storageState = storageState;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(STEALTH_SCRIPT);
  return ctx;
}
