import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { PlaywrightBrowser, PlaywrightPersistentBrowser } from './playwright-adapter.js';
import { BROWSER_PROFILES_DIR } from './config.js';

// Initialize stealth plugin
puppeteer.use(StealthPlugin());

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const BROWSER_PREF_FILE = path.join(__dirname, '..', 'session', 'browser.json');

// ─── Browser engines ───────────────────────────────────────────────────────

const ENGINES = {
  playwright:    { name: 'Playwright (ariaSnapshot scraping)' },
  'real-chrome': { name: 'Real Chrome (connect over CDP)', aiBlocked: true },
  'real-brave':  { name: 'Real Brave (connect over CDP)', aiBlocked: true },
  'real-opera':  { name: 'Real Opera (connect over CDP)', aiBlocked: true },
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
    if (data.browser === 'real' && ENGINES['real-chrome']) return 'real-chrome';
    if (ENGINES[data.browser]) return data.browser;
  } catch { /* ignore */ }
  return 'playwright'; // default
}

export function readAiBrowserPref() {
  try {
    const data = JSON.parse(fs.readFileSync(BROWSER_PREF_FILE, 'utf8'));
    if (data.aiBrowser && ENGINES[data.aiBrowser]) return data.aiBrowser;
  } catch { /* ignore */ }
  return 'playwright'; // default
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
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(BROWSER_PREF_FILE, 'utf8'));
  } catch { /* ignore */ }
  data.browser = key;
  fs.writeFileSync(BROWSER_PREF_FILE, JSON.stringify(data, null, 2));
}

export function saveAiBrowserPref(key) {
  const dir = path.dirname(BROWSER_PREF_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(BROWSER_PREF_FILE, 'utf8'));
  } catch { /* ignore */ }
  data.aiBrowser = key;
  fs.writeFileSync(BROWSER_PREF_FILE, JSON.stringify(data, null, 2));
}

export function getEngineList() {
  return Object.entries(ENGINES).map(([key, info]) => ({
    key,
    name: info.name,
    blocked: !!info.blocked,
    aiBlocked: !!info.aiBlocked
  }));
}

const USER_AGENTS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * Generate a version-matched User-Agent string.
 * Ported from Scrapling's fingerprints.py — the key insight is that if your
 * Playwright launches Chromium v128 but your UA says Chrome/120, anti-bot
 * systems detect the mismatch. This extracts the actual version at runtime.
 *
 * @param {string} channel - 'chrome' | 'chromium' | 'msedge'
 * @returns {string} User-Agent string matching the platform + version
 */
export function generateMatchedUserAgent(channel = 'chrome') {
  try {
    // Try to detect installed Chrome version from the executable
    const os = process.platform;
    let version = '128.0.0.0'; // Reasonable modern default

    if (os === 'win32') {
      try {
        const { execSync } = require('child_process');
        const output = execSync(
          'reg query "HKLM\\SOFTWARE\\Google\\Chrome\\BLBeacon" /v version 2>nul',
          { encoding: 'utf8', timeout: 3000 }
        );
        const match = output.match(/version\s+REG_SZ\s+(\S+)/i);
        if (match) version = match[1];
      } catch { /* Use default */ }
    }

    const platform = os === 'win32' ? 'Windows NT 10.0; Win64; x64'
      : os === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';

    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  } catch {
    return USER_AGENTS.chrome; // Fallback to hardcoded
  }
}

// Generate at module load time so it's consistent for the session
const MATCHED_UA = generateMatchedUserAgent();

// ─── Launch & context ──────────────────────────────────────────────────────

export async function launchBrowser(visible = false, profileSuffix = '', options = {}) {
  let pref = options.engine || (options.forceAutomated ? readAiBrowserPref() : readBrowserPref());

  if (options.forceAutomated && ENGINES[pref]?.aiBlocked) {
    console.log(`  ⚠ Selected AI engine '${pref}' is blocked. Falling back to playwright for automated run.`);
    pref = 'playwright';
  }

  if (ENGINES[pref] && REAL_BROWSER_CONFIG[pref]) {
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

  // Playwright with persistent profile — keeps Google OAuth cookies between apply runs.
  if (options.persistentProfile && pref === 'playwright') {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error('Playwright not installed.');
    }
    const profileDir = path.join(BROWSER_PROFILES_DIR, profileSuffix || 'default');
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: 'chrome',
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--window-size=1280,900',
      ],
      viewport: { width: 1280, height: 900 },
      userAgent: MATCHED_UA,
    });
    return new PlaywrightPersistentBrowser(context);
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
  return new PlaywrightBrowser(pwBrowser, { userAgent: MATCHED_UA });
}

export async function newStealthContext(browser, storageStatePath = null) {
  // Persistent context already carries cookies/localStorage — skip re-init.
  if (browser instanceof PlaywrightPersistentBrowser) {
    return browser;
  }
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
      userAgent: MATCHED_UA,
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
        await page.setUserAgent(MATCHED_UA);
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
