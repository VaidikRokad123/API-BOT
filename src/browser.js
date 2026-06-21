import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { PlaywrightBrowser } from './playwright-adapter.js';

// Initialize stealth plugin
puppeteer.use(StealthPlugin());

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const BROWSER_PREF_FILE = path.join(__dirname, '..', 'session', 'browser.json');

// ─── Browser engines ───────────────────────────────────────────────────────

const ENGINES = {
  playwright:    { name: 'Playwright (ariaSnapshot scraping)' },
  'real-chrome': { name: 'Real Chrome (connect over CDP)' },
  'real-brave':  { name: 'Real Brave (connect over CDP)' },
  'real-opera':  { name: 'Real Opera (connect over CDP)' },
};

const REAL_BROWSER_CONFIG = {
  'real-chrome': {
    label: 'Chrome',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    port: 9222,
    cdpUrl: process.env.REAL_CHROME_CDP_URL || 'http://127.0.0.1:9222',
    command: '& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222',
  },
  'real-brave': {
    label: 'Brave',
    executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    port: 9223,
    cdpUrl: process.env.REAL_BRAVE_CDP_URL || 'http://127.0.0.1:9223',
    command: '& "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --remote-debugging-port=9223',
  },
  'real-opera': {
    label: 'Opera',
    executablePath: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera', 'opera.exe'),
    port: 9224,
    cdpUrl: process.env.REAL_OPERA_CDP_URL || 'http://127.0.0.1:9224',
    command: '& "$env:LOCALAPPDATA\\Programs\\Opera\\opera.exe" --remote-debugging-port=9224',
  },
};
const realBrowserConnections = new WeakSet();

export function readBrowserPref() {
  try {
    const data = JSON.parse(fs.readFileSync(BROWSER_PREF_FILE, 'utf8'));
    if (data.browser === 'real') return 'real-chrome';
    if (ENGINES[data.browser]) return data.browser;
    // Any retired engine (chrome/chromium/selenium/firefox/webkit) → Playwright.
  } catch { /* ignore */ }
  return 'playwright'; // default: self-contained engine, no manual browser start
}

function markRealBrowserConnection(browser) {
  realBrowserConnections.add(browser);
  const disconnect = typeof browser.disconnect === 'function'
    ? browser.disconnect.bind(browser)
    : null;
  if (disconnect) {
    browser.close = async () => disconnect();
  }
  return browser;
}

function isRealBrowserConnection(browser) {
  return realBrowserConnections.has(browser);
}

async function connectRealBrowser(realConfig) {
  const browser = await puppeteer.connect({
    browserURL: realConfig.cdpUrl,
    defaultViewport: null,
  });
  return markRealBrowserConnection(browser);
}

function startRealBrowser(realConfig) {
  if (!realConfig.executablePath || !fs.existsSync(realConfig.executablePath)) {
    throw new Error(`Could not find ${realConfig.label} executable at ${realConfig.executablePath}`);
  }
  const child = spawn(realConfig.executablePath, [
    `--remote-debugging-port=${realConfig.port}`,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

async function waitForRealBrowser(realConfig, timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await connectRealBrowser(realConfig);
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${realConfig.cdpUrl}`);
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
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ─── Launch & context ──────────────────────────────────────────────────────

export async function launchBrowser(visible = false, profileSuffix = '', options = {}) {
  let pref = options.engine || readBrowserPref();

  // AI / login / council sessions must never hijack the user's real browser —
  // fall back to the controllable Playwright engine.
  if (options.forceAutomated && pref.startsWith('real-')) {
    pref = 'playwright';
  }

  if (REAL_BROWSER_CONFIG[pref]) {
    const realConfig = REAL_BROWSER_CONFIG[pref];
    try {
      return await connectRealBrowser(realConfig);
    } catch (err) {
      try {
        console.log(`  Real ${realConfig.label} is not listening at ${realConfig.cdpUrl}. Trying to start it...`);
        startRealBrowser(realConfig);
        return await waitForRealBrowser(realConfig);
      } catch (startErr) {
        const originalMessage = err?.message || String(err);
        const startMessage = startErr?.message || String(startErr);
        const alreadyRunningHint = /fetch failed|ECONNREFUSED|ECONNRESET|Timed out/i.test(startMessage)
          ? `If ${realConfig.label} is already open, close every ${realConfig.label} window/process first, then retry. Existing browser processes often ignore new --remote-debugging-port flags.\n`
          : '';
      throw new Error(
        `Could not connect to Real ${realConfig.label} at ${realConfig.cdpUrl}.\n` +
        `Start ${realConfig.label} with remote debugging first, then retry:\n` +
        `  ${realConfig.command}\n` +
          alreadyRunningHint +
          `Original error: ${originalMessage}\n` +
          `Auto-start error: ${startMessage}`
      );
      }
    }
  }

  // Everything that isn't a real-browser connection runs on Playwright — the only
  // bundled engine. MUST be headful with the real Chrome channel: headless bundled
  // Chromium trips Cloudflare on ChatGPT/providers (challenge page → readySelector
  // never appears → openAiSession stalls). `visible`/`profileSuffix` are unused here.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright not installed. Run:\n  npm install playwright\n  npx playwright install chromium');
  }
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

  const ctx = browser.defaultBrowserContext();
  const originalNewPage = ctx.newPage ? ctx.newPage.bind(ctx) : browser.newPage.bind(browser);
  const realBrowser = isRealBrowserConnection(browser);

  // We define target wrapper so it has a newPage method
  const wrapper = {
    newPage: async () => {
      const page = await originalNewPage();

      if (!realBrowser) {
        const pref = readBrowserPref();
        await page.setUserAgent(USER_AGENTS[pref] || USER_AGENTS.chrome);
        await page.setViewport({ width: 1280, height: 900 });
      }

      if (!realBrowser && storageStatePath && fs.existsSync(storageStatePath)) {
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
