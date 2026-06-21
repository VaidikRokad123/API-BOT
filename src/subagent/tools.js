import { executeAction } from '../apply/executor.js';
import { attributeSelector, idFromLegacySelector } from '../apply/selector.js';
import { detectAndHandlePopup } from '../apply/popup-handler.js';

async function findActionElement(page, selector) {
  if (selector.includes(' >>> ')) {
    const parts = selector.split(' >>> ');
    let currentFrame = page.mainFrame ? page.mainFrame() : page;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        const direct = await currentFrame.$(part).catch(() => null);
        if (direct) return direct;
        const legacyId = idFromLegacySelector(part);
        return legacyId ? currentFrame.$(attributeSelector('id', legacyId)).catch(() => null) : null;
      } else {
        const frameEl = await currentFrame.$(part).catch(() => null);
        if (frameEl) {
          currentFrame = await frameEl.contentFrame().catch(() => null);
        } else {
          return null;
        }
      }
    }
  }
  const direct = await page.$(selector).catch(() => null);
  if (direct) return direct;
  const legacyId = idFromLegacySelector(selector);
  return legacyId ? page.$(attributeSelector('id', legacyId)).catch(() => null) : null;
}

export const TOOL_REGISTRY = {
  navigate: {
    description: 'Navigate to a specific URL',
    params: { url: 'string' },
    run: async (page, args) => {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return `Navigated to ${args.url}`;
    }
  },
  click: {
    description: 'Click an element specified by a CSS selector',
    params: { selector: 'string' },
    run: async (page, args, ctx) => {
      await executeAction(page, { type: 'click', selector: args.selector }, ctx.profile || {});
      return `Clicked element ${args.selector}`;
    }
  },
  fill: {
    description: 'Fill a text input with a value',
    params: { selector: 'string', value: 'string' },
    run: async (page, args, ctx) => {
      await executeAction(page, { type: 'fill', selector: args.selector, value: args.value }, ctx.profile || {});
      return `Filled input ${args.selector} with "${args.value}"`;
    }
  },
  select: {
    description: 'Select an option from a dropdown list',
    params: { selector: 'string', value: 'string' },
    run: async (page, args, ctx) => {
      await executeAction(page, { type: 'select', selector: args.selector, value: args.value }, ctx.profile || {});
      return `Selected option "${args.value}" in dropdown ${args.selector}`;
    }
  },
  check: {
    description: 'Check a checkbox or choose a radio button',
    params: { selector: 'string' },
    run: async (page, args, ctx) => {
      await executeAction(page, { type: 'check', selector: args.selector }, ctx.profile || {});
      return `Checked option ${args.selector}`;
    }
  },
  upload: {
    description: 'Upload a file using file chooser',
    params: { selector: 'string' },
    run: async (page, args, ctx) => {
      await executeAction(page, { type: 'upload', selector: args.selector }, ctx.profile || {});
      return `Uploaded file using ${args.selector}`;
    }
  },
  scroll: {
    description: 'Scroll the page vertically or scroll an element into view',
    params: { direction: 'string?', selector: 'string?' },
    run: async (page, args) => {
      if (args.selector) {
        const el = await findActionElement(page, args.selector);
        if (el) {
          await page.evaluate(e => e.scrollIntoView({ block: 'center' }), el);
          return `Scrolled element ${args.selector} into view`;
        }
        return `Element ${args.selector} not found to scroll`;
      }
      const dir = args.direction || 'down';
      if (dir === 'down') {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      } else {
        await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 0.8));
      }
      return `Scrolled page ${dir}`;
    }
  },
  hover: {
    description: 'Hover the mouse pointer over a selector',
    params: { selector: 'string' },
    run: async (page, args) => {
      const el = await findActionElement(page, args.selector);
      if (el) {
        const box = await el.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await el.hover?.().catch(() => {});
        }
        return `Hovered over ${args.selector}`;
      }
      return `Element ${args.selector} not found to hover`;
    }
  },
  press: {
    description: 'Press a keyboard key',
    params: { key: 'string' },
    run: async (page, args) => {
      await page.keyboard.press(args.key);
      return `Pressed key "${args.key}"`;
    }
  },
  wait: {
    description: 'Wait for a duration or for a selector to appear',
    params: { ms: 'number?', selector: 'string?' },
    run: async (page, args) => {
      if (args.selector) {
        const found = await page.waitForSelector(args.selector, { visible: true, timeout: 8000 }).catch(() => null);
        return found ? `Selector ${args.selector} appeared` : `Timeout waiting for ${args.selector}`;
      }
      const delay = args.ms || 1000;
      await new Promise(r => setTimeout(r, delay));
      return `Waited for ${delay}ms`;
    }
  },
  read: {
    description: 'Read the page state',
    params: {},
    run: async () => {
      return 'State read successfully';
    }
  },
  screenshot: {
    description: 'Take a step screenshot',
    params: { label: 'string?' },
    run: async (page, args, ctx) => {
      if (ctx.run && typeof ctx.run.saveScreenshot === 'function') {
        const name = await ctx.run.saveScreenshot(page, ctx.step || 0, args.label || 'manual');
        return `Screenshot saved as ${name}`;
      }
      return 'Screenshot tool invoked but no run context available';
    }
  },
  extract: {
    description: 'Extract text contents of an element',
    params: { selector: 'string?' },
    run: async (page, args) => {
      const el = await findActionElement(page, args.selector || 'body');
      if (el) {
        const text = await page.evaluate(e => e.innerText || e.textContent, el);
        return `Extracted text: ${String(text).slice(0, 500)}`;
      }
      return `Element ${args.selector || 'body'} not found`;
    }
  },
  handle_login: {
    description: 'Handle login popups or OAuth windows',
    params: {},
    run: async (page, args, ctx) => {
      const handled = await detectAndHandlePopup(ctx.browser, page, ctx.profile || {}, ctx.aiPage);
      return handled ? 'OAuth popup handled successfully' : 'No active OAuth popup detected';
    }
  }
};
