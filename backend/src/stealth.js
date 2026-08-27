/**
 * Universal Anti-Bot Evasion & Challenge Solver Engine
 * Incorporates techniques from Scrapling, PinchTab, and BrowserForge.
 */

// ─── 1. CLIENT-SIDE STEALTH INJECTION SCRIPT ────────────────────────────────
export const STEALTH_INJECTION_SCRIPT = `
(function() {
  'use strict';

  // 1. MASK FUNCTION TOSTRING -> [native code]
  const nativeToString = Function.prototype.toString;
  const nativeFnMap = new WeakMap();

  function makeNativeString(name) {
    const trimmed = (typeof name === 'string') ? name.trim() : '';
    return trimmed ? 'function ' + trimmed + '() { [native code] }' : 'function () { [native code] }';
  }

  function maskAsNative(fn, name) {
    if (typeof fn !== 'function') return fn;
    try { nativeFnMap.set(fn, makeNativeString(name || fn.name || '')); } catch (e) {}
    return fn;
  }

  try {
    function customToString() {
      if (typeof this === 'function') {
        const custom = nativeFnMap.get(this);
        if (custom) return custom;
      }
      return Reflect.apply(nativeToString, this, []);
    }
    maskAsNative(customToString, 'toString');
    Object.defineProperty(Function.prototype, 'toString', {
      value: customToString,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  } catch (e) {}

  // 2. NAVIGATOR.WEBDRIVER REMOVAL
  try {
    const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
    delete navProto.webdriver;
    delete navigator.webdriver;
    Object.defineProperty(navProto, 'webdriver', {
      get: maskAsNative(() => undefined, 'get webdriver'),
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // 3. CDP MARKER CLEANUP (cdc_*, __webdriver, __selenium, __puppeteer, __playwright)
  try {
    const cdpPatterns = [/^cdc_/, /^\$cdc_/, /^__webdriver/, /^__selenium/, /^__driver/, /^__puppeteer/, /^__playwright/];
    for (const prop of Object.getOwnPropertyNames(window)) {
      if (cdpPatterns.some(p => p.test(prop))) {
        try { delete window[prop]; } catch (e) {}
      }
    }
  } catch (e) {}

  // 4. WINDOW.CHROME & CHROME.RUNTIME EMULATION
  try {
    if (!window.chrome) { window.chrome = {}; }
    const makeEvent = () => ({
      addListener: maskAsNative(function addListener() {}, 'addListener'),
      removeListener: maskAsNative(function removeListener() {}, 'removeListener'),
      hasListener: maskAsNative(function hasListener() { return false; }, 'hasListener'),
    });

    window.chrome.runtime = window.chrome.runtime || {
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      connect: maskAsNative(function connect() {
        return {
          name: '',
          onDisconnect: makeEvent(),
          onMessage: makeEvent(),
          postMessage: maskAsNative(function postMessage() {}, 'postMessage'),
          disconnect: maskAsNative(function disconnect() {}, 'disconnect'),
        };
      }, 'connect'),
      sendMessage: maskAsNative(function sendMessage(id, msg, opts, cb) {
        if (typeof cb === 'function') setTimeout(cb, 0);
      }, 'sendMessage'),
      onConnect: makeEvent(),
      onMessage: makeEvent(),
    };
  } catch (e) {}

  // 5. NAVIGATOR.PLUGINS & MIMETYPES (Full Prototype-Compliant PDF Array)
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      const fakePlugins = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf' }] },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf' }] },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf' }] }
      ];

      const pArray = Object.create(PluginArray.prototype);
      const mArray = Object.create(MimeTypeArray.prototype);

      fakePlugins.forEach((pDef, idx) => {
        const p = Object.create(Plugin.prototype);
        const m = Object.create(MimeType.prototype);
        Object.defineProperties(m, {
          type: { value: pDef.mimeTypes[0].type, enumerable: true },
          suffixes: { value: pDef.mimeTypes[0].suffixes, enumerable: true },
          description: { value: pDef.description, enumerable: true },
          enabledPlugin: { value: p, enumerable: true },
        });
        Object.defineProperties(p, {
          name: { value: pDef.name, enumerable: true },
          filename: { value: pDef.filename, enumerable: true },
          description: { value: pDef.description, enumerable: true },
          length: { value: 1, enumerable: true },
          0: { value: m, enumerable: true },
        });
        Object.defineProperty(pArray, idx, { value: p, enumerable: true });
        Object.defineProperty(pArray, pDef.name, { value: p, enumerable: false });
        Object.defineProperty(mArray, idx, { value: m, enumerable: true });
        Object.defineProperty(mArray, m.type, { value: m, enumerable: false });
      });

      Object.defineProperty(pArray, 'length', { value: fakePlugins.length, enumerable: true });
      Object.defineProperty(mArray, 'length', { value: fakePlugins.length, enumerable: true });

      const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
      Object.defineProperty(navProto, 'plugins', { get: maskAsNative(() => pArray, 'get plugins'), configurable: true });
      Object.defineProperty(navProto, 'mimeTypes', { get: maskAsNative(() => mArray, 'get mimeTypes'), configurable: true });
    }
  } catch (e) {}

  // 6. NAVIGATOR.PERMISSIONS QUERY
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const origQuery = navigator.permissions.query;
      navigator.permissions.query = maskAsNative(function query(params) {
        return (params && params.name === 'notifications')
          ? Promise.resolve({ state: Notification.permission || 'default', onchange: null })
          : Reflect.apply(origQuery, navigator.permissions, [params]);
      }, 'query');
    }
  } catch (e) {}

  // 7. SCREEN & WINDOW DIMENSIONS (Fix 0-value headless flags)
  try {
    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 900;
    const outerW = Math.max(window.outerWidth || 0, width);
    const outerH = Math.max(window.outerHeight || 0, height + 80);

    Object.defineProperty(window, 'outerWidth', { get: maskAsNative(() => outerW, 'get outerWidth'), configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: maskAsNative(() => outerH, 'get outerHeight'), configurable: true });
    Object.defineProperty(screen, 'availWidth', { get: maskAsNative(() => outerW, 'get availWidth'), configurable: true });
    Object.defineProperty(screen, 'availHeight', { get: maskAsNative(() => outerH, 'get availHeight'), configurable: true });
    Object.defineProperty(screen, 'width', { get: maskAsNative(() => outerW, 'get width'), configurable: true });
    Object.defineProperty(screen, 'height', { get: maskAsNative(() => outerH, 'get height'), configurable: true });
    Object.defineProperty(screen, 'colorDepth', { get: maskAsNative(() => 24, 'get colorDepth'), configurable: true });
  } catch (e) {}

  // 8. WEBGL VENDOR & RENDERER SPOOFING (Avoid Software/Mesa/SwiftShader flags)
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    const customGetParameter = maskAsNative(function getParameter(param) {
      if (param === 37445) return 'Google Inc. (Intel)';
      if (param === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return Reflect.apply(getParameter, this, [param]);
    }, 'getParameter');

    WebGLRenderingContext.prototype.getParameter = customGetParameter;
    if (typeof WebGL2RenderingContext !== 'undefined') {
      WebGL2RenderingContext.prototype.getParameter = customGetParameter;
    }
  } catch (e) {}

  // 9. CLIENT HINTS (navigator.userAgentData)
  try {
    if (!navigator.userAgentData) {
      const uaData = {
        brands: [
          { brand: 'Chromium', version: '133' },
          { brand: 'Not(A:Brand', version: '99' },
          { brand: 'Google Chrome', version: '133' }
        ],
        mobile: false,
        platform: navigator.platform.includes('Mac') ? 'macOS' : (navigator.platform.includes('Linux') ? 'Linux' : 'Windows'),
        getHighEntropyValues: maskAsNative(async function getHighEntropyValues(hints) {
          return {
            brands: uaData.brands,
            mobile: false,
            platform: uaData.platform,
            architecture: 'x86',
            bitness: '64',
            model: '',
            platformVersion: '15.0.0',
            uaFullVersion: '133.0.6943.127'
          };
        }, 'getHighEntropyValues'),
        toJSON: maskAsNative(function toJSON() {
          return { brands: uaData.brands, mobile: uaData.mobile, platform: uaData.platform };
        }, 'toJSON')
      };
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        get: maskAsNative(() => uaData, 'get userAgentData'),
        configurable: true,
        enumerable: true
      });
    }
  } catch (e) {}
})();
`;

// ─── 2. CHROMIUM STEALTH LAUNCH SWITCHES ────────────────────────────────────
export const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
  '--start-maximized',
  '--lang=en-US',
  '--accept-lang=en-US',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-ipc-flooding-protection',
  '--enable-features=NetworkService,NetworkServiceInProcess,TrustTokens,TrustTokensAlwaysAllowIssuance',
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
  '--disable-features=IsolateOrigins,site-per-process,AudioServiceOutOfProcess,TranslateUI,BlinkGenPropertyTrees',
];

// ─── 3. UNIVERSAL ANTI-BOT & CAPTCHA SOLVER ─────────────────────────────────

const CF_CHALLENGE_REGEX = /challenges\.cloudflare\.com|turnstile|cdn-cgi\/challenge-platform/i;
const POPUP_MATCHERS = [
  "stay here", "stay logged out", "dismiss", "ok", "close",
  "got it", "okay, let's go", "accept all", "agree and proceed", "i accept", "continue"
];

/**
 * Automatically inspects the page for Cloudflare Turnstile, Cloudflare Interstitial,
 * and blocking overlays, solving challenges and dismissing popups.
 *
 * @param {object} page - Playwright page or PlaywrightPage wrapper
 * @param {object} options - Configuration options
 * @returns {Promise<{ solved: boolean, challengeType: string | null }>}
 */
export async function solveAntiBotChallenge(page, { maxWaitMs = 30000, pollIntervalMs = 800 } = {}) {
  const startTime = Date.now();
  let challengeDetected = false;
  let detectedType = null;

  while (Date.now() - startTime < maxWaitMs) {
    let url = '';
    let title = '';
    try {
      url = page.url ? page.url() : '';
      title = page.title ? await page.title() : '';
    } catch {
      break;
    }

    const isCfWaitPage = url.includes('__cf_chl_rt_tk') || title.includes('Just a moment') || title.includes('Cloudflare');

    // 1. Check for Turnstile in frames
    let turnstileBox = null;
    let turnstileFrame = null;

    try {
      const frames = page.frames ? page.frames() : [];
      for (const frame of frames) {
        const fUrl = frame.url ? frame.url() : '';
        if (CF_CHALLENGE_REGEX.test(fUrl)) {
          challengeDetected = true;
          detectedType = 'cloudflare_turnstile';
          turnstileFrame = frame;

          // Search for checkbox inside frame
          const cb = await frame.$('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage, label, span.mark').catch(() => null);
          if (cb) {
            turnstileBox = await cb.boundingBox().catch(() => null);
            if (turnstileBox) break;
          }
        }
      }
    } catch (e) {}

    // 2. Check for Turnstile container in top-level document
    if (!turnstileBox) {
      try {
        const cfContainer = await page.$('#cf_turnstile, #cf-turnstile, .turnstile, iframe[src*="cloudflare"], iframe[src*="turnstile"]').catch(() => null);
        if (cfContainer) {
          challengeDetected = true;
          detectedType = detectedType || 'cloudflare_turnstile';
          turnstileBox = await cfContainer.boundingBox().catch(() => null);
        }
      } catch (e) {}
    }

    // 3. If Turnstile or Challenge is present, execute coordinate click using Scrapling offset formula
    if (turnstileBox && turnstileBox.width > 0 && turnstileBox.height > 0) {
      console.log('  ⏳ [Anti-Bot] Solving Cloudflare Turnstile challenge...');
      
      // Calculate randomized Human click coordinates (Scrapling formula)
      const randomOffsetX = Math.min(turnstileBox.width * 0.5, Math.floor(26 + Math.random() * 3));
      const randomOffsetY = Math.min(turnstileBox.height * 0.5, Math.floor(25 + Math.random() * 3));
      const clickX = turnstileBox.x + randomOffsetX;
      const clickY = turnstileBox.y + randomOffsetY;
      const delay = Math.floor(100 + Math.random() * 100);

      try {
        if (page.mouse && page.mouse.click) {
          await page.mouse.click(clickX, clickY, { delay }).catch(() => {});
        } else if (turnstileFrame) {
          const cb = await turnstileFrame.$('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage, label').catch(() => null);
          if (cb) await cb.click().catch(() => {});
        }
      } catch (e) {}

      // Wait a moment for verification callback to fire
      if (page.waitForTimeout) {
        await page.waitForTimeout(1200);
      } else {
        await new Promise(r => setTimeout(r, 1200));
      }
    } else if (isCfWaitPage) {
      challengeDetected = true;
      detectedType = detectedType || 'cloudflare_interstitial';
      console.log('  ⏳ [Anti-Bot] Waiting for Cloudflare verification page to clear...');
      if (page.waitForTimeout) {
        await page.waitForTimeout(pollIntervalMs);
      } else {
        await new Promise(r => setTimeout(r, pollIntervalMs));
      }
    }

    // 4. Automatically dismiss blocking popups / dialogs
    try {
      await page.evaluate((matchers) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          if (matchers.some(m => text === m || text.includes(m))) {
            const rect = btn.getBoundingClientRect();
            const style = window.getComputedStyle(btn);
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
              btn.click();
            }
          }
        }
      }, POPUP_MATCHERS).catch(() => {});
    } catch (e) {}

    // 5. Check if challenge cleared
    try {
      const currUrl = page.url ? page.url() : '';
      const currTitle = page.title ? await page.title() : '';
      const isStillChallenged = currUrl.includes('__cf_chl_rt_tk') || currTitle.includes('Just a moment') || currTitle.includes('Cloudflare');

      if (!isStillChallenged && !turnstileBox) {
        if (challengeDetected) {
          console.log(`  ✓ [Anti-Bot] Challenge solved successfully. Redirected to: ${currUrl}`);
        }
        return { solved: true, challengeType: detectedType };
      }
    } catch (e) {}

    if (page.waitForTimeout) {
      await page.waitForTimeout(pollIntervalMs);
    } else {
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  return { solved: !challengeDetected, challengeType: detectedType };
}
