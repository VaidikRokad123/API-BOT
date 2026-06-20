import { By, until, Key } from 'selenium-webdriver';
import fs from 'fs';
import path from 'path';

export class SeleniumElement {
  constructor(element, driver) {
    this.element = element;
    this.driver = driver;
  }

  async click() {
    await this.element.click();
  }

  async type(text) {
    await this.element.sendKeys(text);
  }

  async uploadFile(...files) {
    const absPath = path.resolve(files[0]);
    await this.element.sendKeys(absPath);
  }

  async boundingBox() {
    const rect = await this.element.getRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  async select(...values) {
    await this.driver.executeScript((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, this.element, values[0]);
  }

  async scrollIntoViewIfNeeded() {
    await this.driver.executeScript(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }), this.element);
  }
}

export class SeleniumPage {
  constructor(driver) {
    this.driver = driver;
    this.cdpConnection = null;

    this.keyboard = {
      type: async (text) => {
        await this.driver.actions().sendKeys(text).perform();
      },
      press: async (key) => {
        let selKey = key;
        if (key === 'Enter') selKey = Key.ENTER;
        else if (key === 'Delete') selKey = Key.DELETE;
        else if (key === 'Backspace') selKey = Key.BACK_SPACE;
        else if (key === 'Tab') selKey = Key.TAB;
        else if (key === 'ArrowUp') selKey = Key.ARROW_UP;
        else if (key === 'ArrowDown') selKey = Key.ARROW_DOWN;
        await this.driver.actions().sendKeys(selKey).perform();
      },
      down: async (key) => {
        let selKey = key;
        if (key === 'Control') selKey = Key.CONTROL;
        else if (key === 'Shift') selKey = Key.SHIFT;
        await this.driver.actions().keyDown(selKey).perform();
      },
      up: async (key) => {
        let selKey = key;
        if (key === 'Control') selKey = Key.CONTROL;
        else if (key === 'Shift') selKey = Key.SHIFT;
        await this.driver.actions().keyUp(selKey).perform();
      }
    };

    this.mouse = {
      move: async (x, y) => {
        await this.driver.actions().move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).perform();
      },
      click: async (x, y) => {
        await this.driver.actions()
          .move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' })
          .press().release().perform();
      },
      down: async () => {
        await this.driver.actions().press().perform();
      },
      up: async () => {
        await this.driver.actions().release().perform();
      }
    };
  }

  url() {
    return this.driver.getCurrentUrl();
  }

  async goto(url, opts = {}) {
    await this.driver.get(url);
  }

  async evaluate(fn, ...args) {
    const unwrappedArgs = args.map(arg => arg instanceof SeleniumElement ? arg.element : arg);
    if (typeof fn === 'function' && fn.constructor.name === 'AsyncFunction') {
      const script = `
        const done = arguments[arguments.length - 1];
        const params = Array.prototype.slice.call(arguments, 0, -1);
        Promise.resolve((${fn.toString()}).apply(null, params))
          .then(value => done({ ok: true, value }))
          .catch(error => done({ ok: false, error: error && error.message ? error.message : String(error) }));
      `;
      const result = await this.driver.executeAsyncScript(script, ...unwrappedArgs);
      if (!result?.ok) throw new Error(result?.error || 'Async page evaluation failed');
      return result.value;
    }

    const script = typeof fn === 'function'
      ? `return (${fn.toString()}).apply(null, arguments);`
      : fn;
    return await this.driver.executeScript(script, ...unwrappedArgs);
  }

  async evaluateOnNewDocument(fn, ...args) {
    try {
      if (!this.cdpConnection) {
        this.cdpConnection = await this.driver.createCDPConnection('page');
      }
      const sourceStr = typeof fn === 'function'
        ? `(${fn.toString()})(${args.map(JSON.stringify).join(',')})`
        : fn;
      await this.driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: sourceStr
      });
    } catch (e) {
      console.warn('  [Selenium] evaluateOnNewDocument warning:', e.message);
    }
  }

  async cookies() {
    const list = await this.driver.manage().getCookies();
    return list.map(c => ({
      name:     c.name,
      value:    c.value,
      domain:   c.domain,
      path:     c.path,
      expires:  c.expiry ?? -1,
      httpOnly: c.httpOnly ?? false,
      secure:   c.secure ?? false,
      sameSite: c.sameSite || 'None',
    }));
  }

  async setCookie(...cookies) {
    // Navigate to a page before setting cookies if we are on about:blank
    const currentUrl = await this.driver.getCurrentUrl();
    if (currentUrl.includes('about:blank') && cookies.length > 0) {
      // In Selenium, you must be on the domain to set its cookies.
      // We navigate briefly or let the user navigate first.
      // Usually the caller sets cookies before goto. To get around this,
      // we'll run a quick get to the base domain if possible, or wait until page load.
      // But standard approach: try to add them directly.
    }
    for (const c of cookies) {
      try {
        await this.driver.manage().addCookie({
          name:     c.name,
          value:    c.value,
          path:     c.path || '/',
          domain:   c.domain,
          secure:   c.secure || false,
          httpOnly: c.httpOnly || false,
          expiry:   c.expires && c.expires !== -1 ? Math.floor(c.expires) : undefined,
          sameSite: c.sameSite || 'None',
        });
      } catch (err) {
        // Ignored if domain doesn't match current url yet (will be set after navigation)
      }
    }
  }

  async waitForSelector(selector, opts = {}) {
    const timeout = opts.timeout || 10000;
    const by = By.css(selector);
    const element = await this.driver.wait(until.elementLocated(by), timeout);
    if (opts.visible) {
      await this.driver.wait(until.elementIsVisible(element), timeout);
    }
    return new SeleniumElement(element, this.driver);
  }

  async $(selector) {
    try {
      const element = await this.driver.findElement(By.css(selector));
      return new SeleniumElement(element, this.driver);
    } catch {
      return null;
    }
  }

  async $$(selector) {
    try {
      const list = await this.driver.findElements(By.css(selector));
      return list.map(el => new SeleniumElement(el, this.driver));
    } catch {
      return [];
    }
  }

  async setUserAgent(ua) {
    // Best effort: set via DevTools command if CDP is supported
    try {
      if (!this.cdpConnection) {
        this.cdpConnection = await this.driver.createCDPConnection('page');
      }
      await this.driver.sendAndGetDevToolsCommand('Network.setUserAgentOverride', {
        userAgent: ua
      });
    } catch { /* ignore */ }
  }

  async setViewport(vp) {
    await this.driver.manage().window().setSize({ width: vp.width, height: vp.height });
  }
}

export class SeleniumBrowser {
  constructor(driver) {
    this.driver = driver;
  }

  async close() {
    await this.driver.quit();
  }

  async newPage() {
    return new SeleniumPage(this.driver);
  }

  async pages() {
    const handles = await this.driver.getAllWindowHandles().catch(() => []);
    const currentHandle = await this.driver.getWindowHandle().catch(() => null);
    const list = [];

    for (const handle of handles) {
      const page = new SeleniumPage(this.driver);

      // Override navigation & evaluation to auto-switch to this specific handle
      const originalGoto = page.goto.bind(page);
      page.goto = async (url, opts) => {
        await this.driver.switchTo().window(handle).catch(() => {});
        await originalGoto(url, opts);
      };

      const originalEvaluate = page.evaluate.bind(page);
      page.evaluate = async (fn, ...args) => {
        await this.driver.switchTo().window(handle).catch(() => {});
        return await originalEvaluate(fn, ...args);
      };

      const originalUrl = page.url.bind(page);
      page.url = async () => {
        await this.driver.switchTo().window(handle).catch(() => {});
        return await originalUrl();
      };

      const originalFind = page.$.bind(page);
      page.$ = async (sel) => {
        await this.driver.switchTo().window(handle).catch(() => {});
        return await originalFind(sel);
      };

      const originalFindAll = page.$$.bind(page);
      page.$$ = async (sel) => {
        await this.driver.switchTo().window(handle).catch(() => {});
        return await originalFindAll(sel);
      };

      const originalWaitForSelector = page.waitForSelector.bind(page);
      page.waitForSelector = async (sel, opts) => {
        await this.driver.switchTo().window(handle).catch(() => {});
        return await originalWaitForSelector(sel, opts);
      };

      list.push(page);
    }

    // Restore active focus
    if (currentHandle) {
      await this.driver.switchTo().window(currentHandle).catch(() => {});
    }

    return list;
  }

  defaultBrowserContext() {
    return this;
  }
}
