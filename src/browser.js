import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Initialize stealth plugin
puppeteer.use(StealthPlugin());

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const BROWSER_PREF_FILE = path.join(__dirname, '..', 'session', 'browser.json');

// ─── Browser engines ───────────────────────────────────────────────────────

const ENGINES = {
  chrome:    { name: 'Chrome (Real Installed)' },
  chromium:  { name: 'Chromium (Bundled)' },
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
};

// ─── Launch & context ──────────────────────────────────────────────────────

export async function launchBrowser(visible = false, profileSuffix = '') {
  const pref = readBrowserPref();

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
