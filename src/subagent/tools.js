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
  click_blank: {
    description: 'Click on a blank/neutral area of the page (default coordinates 10, 10) to dismiss active overlays, dropdowns, popups, or remove focus from inputs',
    params: { x: 'number?', y: 'number?' },
    run: async (page, args) => {
      const x = args.x !== undefined ? args.x : 10;
      const y = args.y !== undefined ? args.y : 10;
      await page.mouse.click(x, y);
      return `Clicked at coordinates (${x}, ${y}) to clear focus/dismiss overlays`;
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
    description: 'Scroll the page vertically (direction "down"/"up") or scroll an element into view',
    params: { direction: 'string?', selector: 'string?', amount: 'number?' },
    run: async (page, args) => {
      if (args.selector) {
        const el = await findActionElement(page, args.selector);
        if (el) {
          await page.evaluate(e => e.scrollIntoView({ block: 'center' }), el);
          await new Promise(r => setTimeout(r, 1200));
          return `Scrolled element ${args.selector} into view`;
        }
        return `Element ${args.selector} not found to scroll`;
      }

      const dir = (args.direction || 'down').toLowerCase();
      const sign = dir === 'up' ? -1 : 1;
      const amount = Number(args.amount) > 0 ? Number(args.amount) : 1000;

      // 1. Real wheel event at the viewport centre. Fires the wheel events that
      //    infinite-scroll listeners need, and scrolls whatever container sits
      //    under the cursor (window OR an inner overflow div).
      let wheeled = false;
      try {
        const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
        await page.mouse.move(Math.floor(vp.w / 2), Math.floor(vp.h / 2));
        if (page.mouse?.wheel) {
          await page.mouse.wheel({ deltaY: sign * amount });
          wheeled = true;
        }
      } catch { /* fall through to DOM scroll */ }

      // 2. DOM fallback: many SPAs (LinkedIn, etc.) scroll an inner element, not
      //    window — so window.scrollBy is a no-op. Find the element that actually
      //    scrolls and move it; verify the position changed.
      const moved = await page.evaluate((s, amt) => {
        const before = window.scrollY;
        const candidates = [document.scrollingElement, document.documentElement, document.body];
        for (const el of document.querySelectorAll('main, [role="main"], div, section')) {
          const st = getComputedStyle(el);
          if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 40) {
            candidates.push(el);
          }
        }
        for (const el of candidates) {
          if (!el) continue;
          const prev = el.scrollTop;
          el.scrollTop += s * amt;
          if (el.scrollTop !== prev) return true;
        }
        window.scrollBy(0, s * amt);
        return window.scrollY !== before;
      }, sign, amount).catch(() => false);

      // Wait for lazy-loaded content before the next observation.
      await new Promise(r => setTimeout(r, 1500));

      if (!wheeled && !moved) return `Tried to scroll ${dir} but the page did not move (content may already be fully loaded or at the edge)`;
      return `Scrolled ${dir} (wheel:${wheeled}, dom:${moved}); waited for lazy content`;
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
    description: 'Re-read the page. The full visible text is returned in the next OBSERVATION → Text. Use after scrolling to capture newly loaded content.',
    params: {},
    run: async (page) => {
      const len = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0);
      return `Page re-read — ${len} chars of text now available in OBSERVATION → Text.`;
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
        return `Extracted text: ${String(text).slice(0, 4000)}`;
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
  },
  signature: {
    description: 'Draw a signature on a canvas element',
    params: { selector: 'string' },
    run: async (page, args, ctx) => {
      await executeAction(page, { type: 'signature', selector: args.selector }, ctx.profile || {});
      return `Drew signature on canvas ${args.selector}`;
    }
  },
  fill_form: {
    description: 'Fill multiple form fields (inputs, dropdowns, checkboxes, radios, canvas signatures, uploads) at once on the current page. Do not include next/submit button clicks here.',
    params: {
      actions: 'array of {type: "fill|select|check|upload|signature", selector: "string", value: "string?"}'
    },
    run: async (page, args, ctx) => {
      if (!args.actions || !Array.isArray(args.actions)) {
        return 'No actions provided for fill_form';
      }
      console.log(`\n  Executing ${args.actions.length} form action(s):`);
      for (const act of args.actions) {
        await executeAction(page, act, ctx.profile || {});
      }
      return `Executed ${args.actions.length} form actions`;
    }
  }
};
