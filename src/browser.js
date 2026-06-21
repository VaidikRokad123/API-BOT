import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { SeleniumBrowser } from './selenium-adapter.js';
import { PlaywrightBrowser } from './playwright-adapter.js';

// Initialize stealth plugin
puppeteer.use(StealthPlugin());

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const BROWSER_PREF_FILE = path.join(__dirname, '..', 'session', 'browser.json');

// ─── Browser engines ───────────────────────────────────────────────────────

const ENGINES = {
  chrome:     { name: 'Chrome (Real Installed)' },
  chromium:   { name: 'Chromium (Bundled)' },
  selenium:   { name: 'Selenium (Chrome Driver)' },
  playwright: { name: 'Playwright (ariaSnapshot scraping)' },
};

export function readBrowserPref() {
  try {
    const data = JSON.parse(fs.readFileSync(BROWSER_PREF_FILE, 'utf8'));
    if (data.browser === 'firefox' || data.browser === 'webkit' || data.browser === 'chromium') {
      return 'chromium'; // Map Playwright engines to bundled Chromium
    }
    if (data.browser === 'puppeteer') return 'chrome';
    if (ENGINES[data.browser]) return data.browser;
  } catch { /* ignore */ }
  return 'chrome'; // default to real Chrome
}

export function saveBrowserPref(key) {
  const dir = path.dirname(BROWSER_PREF_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BROWSER_PREF_FILE, JSON.stringify({ browser: key }));
}

export function getEngineList() {
  return Object.entries(ENGINES).map(([key, { name }]) => ({ key, name }));
}

const USER_AGENTS = {
  chrome:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  chromium: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  selenium: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ─── Launch & context ──────────────────────────────────────────────────────

export async function launchBrowser(visible = false, profileSuffix = '') {
  const pref = readBrowserPref();

  if (pref === 'selenium') {
    const options = new chrome.Options();
    options.addArguments('--disable-blink-features=AutomationControlled');
    options.addArguments('--disable-infobars');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-setuid-sandbox');

    const suffix = profileSuffix ? `-${profileSuffix}` : '';
    const profileDir = path.join(__dirname, '..', 'session', `chrome-profile-selenium${suffix}`);
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    options.addArguments(`--user-data-dir=${profileDir}`);
    options.addArguments('--window-size=1280,900');

    if (!visible) {
      options.addArguments('--headless=new');
    }

    const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    return new SeleniumBrowser(driver);
  }

  if (pref === 'playwright') {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error('Playwright engine selected but not installed. Run:\n  npm install playwright\n  npx playwright install chromium');
    }
    // MUST run headful with the real Chrome channel. Headless bundled Chromium
    // trips Cloudflare on ChatGPT/providers (challenge page → readySelector never
    // appears → openAiSession stalls). This mirrors the working Puppeteer chrome
    // path. `visible` is intentionally ignored, exactly like the chrome branch.
    const pwBrowser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1280,900',
      ],
    });
    return new PlaywrightBrowser(pwBrowser, { userAgent: USER_AGENTS.chrome });
  }

  const launchOpts = {
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  };

  if (pref === 'chrome') {
    launchOpts.channel = 'chrome';
    const suffix = profileSuffix ? `-${profileSuffix}` : '';
    const profileDir = path.join(__dirname, '..', 'session', `chrome-profile${suffix}`);
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    launchOpts.userDataDir = profileDir;
    launchOpts.args.push('--window-size=1280,900');
  } else {
    if (!visible) {
      launchOpts.args.push('--start-minimized');
    }
  }

  return puppeteer.launch(launchOpts);
}

export async function newStealthContext(browser, storageStatePath = null) {
  // Playwright: create one context, seeding storageState directly (session files
  // already use Playwright's {cookies, origins} shape). The browser object itself
  // is the context wrapper — newPage/pages/close all live on it.
  if (browser instanceof PlaywrightBrowser) {
    let storageState;
    if (storageStatePath && fs.existsSync(storageStatePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        // Sanitize cookie sameSite to Playwright's enum to avoid load errors.
        const cookies = (state.cookies || []).map(c => ({
          ...c,
          sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite)
            ? c.sameSite
            : (String(c.sameSite || '').toLowerCase() === 'none' ? 'None'
              : String(c.sameSite || '').toLowerCase() === 'strict' ? 'Strict' : 'Lax'),
        }));
        storageState = { cookies, origins: state.origins || [] };
      } catch (err) {
        console.error('  Failed to restore storageState (Playwright):', err.message);
      }
    }
    await browser.initContext({
      storageState,
      userAgent: USER_AGENTS.chrome,
      viewport: { width: 1280, height: 900 },
    });
    return browser;
  }

  // If this is a Selenium browser, wrap page creation to inject cookies on navigation
  if (browser instanceof SeleniumBrowser) {
    const wrapper = {
      newPage: async () => {
        const page = await browser.newPage();
        const pref = readBrowserPref();
        await page.setUserAgent(USER_AGENTS[pref] || USER_AGENTS.selenium);
        await page.setViewport({ width: 1280, height: 900 });

        if (storageStatePath && fs.existsSync(storageStatePath)) {
          try {
            const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));

            // Hook goto to load cookies and localStorage on page load
            const originalGoto = page.goto.bind(page);
            page.goto = async (url, opts) => {
              await originalGoto(url, opts);

              // 1. Cookies (domain must match current page)
              if (state.cookies && state.cookies.length) {
                await page.setCookie(...state.cookies);
              }

              // 2. LocalStorage (domain must match current page)
              if (state.origins && state.origins.length) {
                const origin = new URL(url).origin;
                const originEntry = state.origins.find(o => o.origin === origin);
                if (originEntry && originEntry.localStorage) {
                  await page.evaluate((items) => {
                    for (const item of items) {
                      window.localStorage.setItem(item.name, item.value);
                    }
                  }, originEntry.localStorage);
                }
              }

              // Reload page to apply changes
              await originalGoto(url, opts);
            };
          } catch (err) {
            console.error('  Failed to restore storageState in Selenium:', err.message);
          }
        }
        return page;
      }
    };

    return new Proxy(wrapper, {
      get(targetObj, prop) {
        if (prop in targetObj) return targetObj[prop];
        const val = browser[prop];
        return typeof val === 'function' ? val.bind(browser) : val;
      }
    });
  }

  const ctx = browser.defaultBrowserContext();
  const originalNewPage = ctx.newPage ? ctx.newPage.bind(ctx) : browser.newPage.bind(browser);

  // We define target wrapper so it has a newPage method
  const wrapper = {
    newPage: async () => {
      const page = await originalNewPage();

      const pref = readBrowserPref();
      await page.setUserAgent(USER_AGENTS[pref] || USER_AGENTS.chrome);
      await page.setViewport({ width: 1280, height: 900 });

      if (storageStatePath && fs.existsSync(storageStatePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));

          // 1. Set cookies
          if (state.cookies && state.cookies.length) {
            await page.setCookie(...state.cookies);
          }

          // 2. Set localStorage via evaluateOnNewDocument
          if (state.origins && state.origins.length) {
            for (const originEntry of state.origins) {
              await page.evaluateOnNewDocument((origin, items) => {
                if (window.location.origin === origin) {
                  for (const item of items) {
                    window.localStorage.setItem(item.name, item.value);
                  }
                }
              }, originEntry.origin, originEntry.localStorage);
            }
          }
        } catch (err) {
          console.error('  Failed to restore storageState:', err.message);
        }
      }

      return page;
    }
  };

  const target = ctx.newPage ? ctx : browser;
  return new Proxy(wrapper, {
    get(targetObj, prop) {
      if (prop in targetObj) return targetObj[prop];
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}
