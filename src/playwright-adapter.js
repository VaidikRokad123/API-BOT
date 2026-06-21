// ─── Playwright Engine Adapter ──────────────────────────────────────────────
// Exposes a Puppeteer-compatible surface (the subset this codebase uses) on top
// of Playwright. Selected when the user picks the "playwright" engine (the
// default); the real-chrome/brave/opera engines keep the Puppeteer CDP-connect
// path untouched. The payoff of choosing Playwright is page.ariaSnapshot(), surfaced
// to the scraper so the AI gets a compact accessibility tree.
//
// Two API gaps bridged here:
//   1. Playwright's page.evaluate takes ONE arg; this code passes many. The
//      wrapper packs args into an array and inlines the original function source
//      so it runs via CDP callFunctionOn — NOT page eval — staying CSP-safe on
//      strict job-application sites.
//   2. ElementHandle method names differ (uploadFile→setInputFiles,
//      select→selectOption). Wrapped on PlaywrightElement.

function mapWaitUntil(waitUntil) {
  if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2') return 'networkidle';
  if (waitUntil === 'load' || waitUntil === 'domcontentloaded' || waitUntil === 'networkidle' || waitUntil === 'commit') return waitUntil;
  return 'domcontentloaded';
}

function mapSameSite(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'strict') return 'Strict';
  if (v === 'none' || v === 'no_restriction') return 'None';
  return 'Lax';
}

export class PlaywrightElement {
  constructor(handle) {
    this.handle = handle;       // Playwright ElementHandle / JSHandle
    this.__pwElement = true;
  }
  asElement() {
    const el = this.handle?.asElement ? this.handle.asElement() : this.handle;
    return el ? new PlaywrightElement(el) : null;
  }
  async click(opts = {}) { await this.handle.click(opts); }
  async type(text, opts = {}) { await this.handle.type(String(text), opts); }
  async uploadFile(...files) { await this.handle.setInputFiles(files); }
  async select(...values) { return this.handle.selectOption(values); }
  async boundingBox() { return this.handle.boundingBox(); }
  async scrollIntoViewIfNeeded() { await this.handle.scrollIntoViewIfNeeded().catch(() => {}); }
  // For an <iframe> handle, the frame it hosts — used by the iframe scraper.
  async contentFrame() {
    const f = await this.handle.contentFrame().catch(() => null);
    return f ? new PlaywrightFrame(f) : null;
  }
}

// Frame wrapper — mirrors the page's CSP-safe multi-arg evaluate so the iframe
// scraper/executor can treat a sub-frame like a page (frames(), mainFrame(),
// parentFrame(), frameElement(), contentFrame()).
export class PlaywrightFrame {
  constructor(frame) { this.frame = frame; this.__pwFrame = true; }
  url() { return this.frame.url(); }
  parentFrame() {
    const p = this.frame.parentFrame();
    return p ? new PlaywrightFrame(p) : null;
  }
  async frameElement() {
    const el = await this.frame.frameElement().catch(() => null);
    return el ? new PlaywrightElement(el) : null;
  }
  async contentFrame() { return this; }
  async evaluate(fn, ...args) {
    if (typeof fn !== 'function') return this.frame.evaluate(fn);
    return this.frame.evaluate(buildWrapper(fn), args.map(unwrap));
  }
  async evaluateHandle(fn, ...args) {
    const h = typeof fn === 'function'
      ? await this.frame.evaluateHandle(buildWrapper(fn), args.map(unwrap))
      : await this.frame.evaluateHandle(fn);
    return new PlaywrightElement(h);
  }
  async $(selector) {
    const el = await this.frame.$(selector).catch(() => null);
    return el ? new PlaywrightElement(el) : null;
  }
  async $$(selector) {
    const list = await this.frame.$$(selector).catch(() => []);
    return list.map(el => new PlaywrightElement(el));
  }
}

function unwrap(arg) {
  return (arg && arg.__pwElement) ? arg.handle : arg;
}

// Build a CSP-safe single-arg wrapper at NODE level (Node has no page CSP).
// Playwright injects the wrapper via callFunctionOn, so the page never evals.
function buildWrapper(fn) {
  const src = fn.toString();
  // eslint-disable-next-line no-new-func
  return new Function('packed', `return (${src}).apply(null, packed);`);
}

export class PlaywrightPage {
  constructor(page, context) {
    this.page = page;
    this.context = context;

    this.keyboard = {
      type: (text, opts = {}) => this.page.keyboard.type(String(text), opts),
      press: (key) => this.page.keyboard.press(key),
      down: (key) => this.page.keyboard.down(key),
      up: (key) => this.page.keyboard.up(key),
    };

    this.mouse = {
      move: (x, y, opts = {}) => this.page.mouse.move(x, y, opts),
      click: (x, y, opts = {}) => this.page.mouse.click(x, y, opts),
      down: (opts = {}) => this.page.mouse.down(opts),
      up: (opts = {}) => this.page.mouse.up(opts),
    };
  }

  url() { return this.page.url(); }                 // sync string, like Puppeteer
  title() { return this.page.title(); }
  isClosed() { return this.page.isClosed(); }

  // Frame access — required by the iframe-aware scraper/executor. Without these,
  // page.frames() is undefined and scrapePageState crashes on this engine.
  frames() { return this.page.frames().map(f => new PlaywrightFrame(f)); }
  mainFrame() { return new PlaywrightFrame(this.page.mainFrame()); }

  async goto(url, opts = {}) {
    return this.page.goto(url, {
      waitUntil: mapWaitUntil(opts.waitUntil),
      timeout: opts.timeout ?? 30000,
    });
  }

  async evaluate(fn, ...args) {
    if (typeof fn !== 'function') return this.page.evaluate(fn);
    return this.page.evaluate(buildWrapper(fn), args.map(unwrap));
  }

  async evaluateHandle(fn, ...args) {
    const handle = typeof fn === 'function'
      ? await this.page.evaluateHandle(buildWrapper(fn), args.map(unwrap))
      : await this.page.evaluateHandle(fn);
    return new PlaywrightElement(handle);
  }

  async $(selector) {
    const el = await this.page.$(selector).catch(() => null);
    return el ? new PlaywrightElement(el) : null;
  }

  async $$(selector) {
    const list = await this.page.$$(selector).catch(() => []);
    return list.map(el => new PlaywrightElement(el));
  }

  async waitForSelector(selector, opts = {}) {
    const el = await this.page.waitForSelector(selector, {
      state: opts.visible ? 'visible' : 'attached',
      timeout: opts.timeout ?? 30000,
    });
    return el ? new PlaywrightElement(el) : null;
  }

  async waitForNavigation(opts = {}) {
    return this.page.waitForNavigation({
      waitUntil: mapWaitUntil(opts.waitUntil),
      timeout: opts.timeout ?? 30000,
    }).catch(() => {});
  }

  async waitForFileChooser(opts = {}) {
    const chooser = await this.page.waitForEvent('filechooser', { timeout: opts.timeout ?? 30000 });
    return {
      accept: async (files) => chooser.setFiles(files),
      cancel: async () => {},
    };
  }

  // ariaSnapshot — the reason to pick this engine. Compact accessibility tree
  // (role + accessible name + state), far fewer tokens than raw DOM.
  async ariaSnapshot() {
    try { return await this.page.locator('body').ariaSnapshot(); }
    catch { return null; }
  }

  async setUserAgent() { /* set at context creation in Playwright */ }
  async setViewport(vp) { return this.page.setViewportSize({ width: vp.width, height: vp.height }); }

  async cookies() { return this.context.cookies(); }

  async setCookie(...cookies) {
    const mapped = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires : -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: mapSameSite(c.sameSite),
    }));
    await this.context.addCookies(mapped).catch(() => {});
  }

  async evaluateOnNewDocument(fn, ...args) {
    // Playwright addInitScript takes a single arg; pack like evaluate.
    if (typeof fn === 'function') {
      await this.context.addInitScript(buildWrapper(fn), args.map(unwrap)).catch(() => {});
    } else {
      await this.context.addInitScript(fn).catch(() => {});
    }
  }

  async screenshot(opts = {}) { return this.page.screenshot(opts); }
  on(event, cb) { this.page.on(event, cb); }
  video() { return this.page.video(); }
  async close() { return this.page.close(); }
}

export class PlaywrightBrowser {
  constructor(browser, { userAgent } = {}) {
    this.browser = browser;
    this.context = null;
    this.userAgent = userAgent;
  }

  // Create the single context for this engine, optionally seeding storageState.
  // Session files already use Playwright's storageState shape ({cookies,origins}).
  async initContext({ storageState, userAgent, viewport, recordVideo } = {}) {
    if (this.context) return this.context;
    const opts = { viewport: viewport || { width: 1280, height: 900 } };
    if (userAgent || this.userAgent) opts.userAgent = userAgent || this.userAgent;
    if (storageState) opts.storageState = storageState;
    if (recordVideo) opts.recordVideo = recordVideo;
    this.context = await this.browser.newContext(opts);
    return this.context;
  }

  async newPage() {
    if (!this.context) await this.initContext();
    const page = await this.context.newPage();
    return new PlaywrightPage(page, this.context);
  }

  async pages() {
    if (!this.context) return [];
    return this.context.pages().map(p => new PlaywrightPage(p, this.context));
  }

  defaultBrowserContext() { return this; }

  async close() { await this.browser.close().catch(() => {}); }
}
