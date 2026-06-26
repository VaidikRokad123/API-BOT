import { redactCredentialArgs } from '../credentials.js';
import { attributeSelector, idFromLegacySelector } from './selector.js';
import { perceive, act as executeSubagentAction, enforceActionPermission, waitForStable } from './engine.js';
import { handleOAuthPages } from './oauth.js';

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
      await waitForStable(page);
      return `Navigated to ${args.url}`;
    }
  },
  click: {
    description: 'Click an element specified by a CSS selector',
    params: { selector: 'string?', ref: 'string?', category: 'submit_application|oauth_login?' },
    run: async (page, args, ctx) => {
      await executeSubagentAction(page, { type: 'click', selector: args.selector, ref: args.ref, category: args.category }, ctx);
      return `Clicked element ${args.selector || args.ref}`;
    }
  },
  click_blank: {
    description: 'Click on a blank/neutral area of the page (default coordinates 10, 10) to dismiss active overlays, dropdowns, popups, or remove focus from inputs',
    params: { x: 'number?', y: 'number?' },
    run: async (page, args) => {
      const x = args.x !== undefined ? args.x : 10;
      const y = args.y !== undefined ? args.y : 10;
      await page.mouse.click(x, y);
      await waitForStable(page);
      return `Clicked at coordinates (${x}, ${y}) to clear focus/dismiss overlays`;
    }
  },
  fill: {
    description: 'Fill a text input with a value',
    params: { selector: 'string?', ref: 'string?', value: 'string' },
    run: async (page, args, ctx) => {
      await executeSubagentAction(page, { type: 'fill', selector: args.selector, ref: args.ref, value: args.value }, ctx);
      const safeArgs = redactCredentialArgs(args);
      return `Filled input ${safeArgs.selector || safeArgs.ref}${safeArgs.value === '[credential]' ? ' with [credential]' : ''}`;
    }
  },
  select: {
    description: 'Select an option from a dropdown list',
    params: { selector: 'string?', ref: 'string?', value: 'string', optionKind: 'native_select|custom_combobox?' },
    run: async (page, args, ctx) => {
      await executeSubagentAction(page, { type: 'select', selector: args.selector, ref: args.ref, value: args.value, optionKind: args.optionKind }, ctx);
      return `Selected option "${args.value}" in dropdown ${args.selector || args.ref}`;
    }
  },
  check: {
    description: 'Check a checkbox or choose a radio button',
    params: { selector: 'string?', ref: 'string?' },
    run: async (page, args, ctx) => {
      await executeSubagentAction(page, { type: 'check', selector: args.selector, ref: args.ref }, ctx);
      return `Checked option ${args.selector || args.ref}`;
    }
  },
  upload: {
    description: 'Upload a file using file chooser',
    params: { selector: 'string?', ref: 'string?' },
    run: async (page, args, ctx) => {
      await executeSubagentAction(page, { type: 'upload', selector: args.selector, ref: args.ref }, ctx);
      return `Uploaded file using ${args.selector || args.ref}`;
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
      await waitForStable(page);
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
      await waitForStable(page);

      if (!wheeled && !moved) return `Tried to scroll ${dir} but the page did not move (content may already be fully loaded or at the edge)`;
      return `Scrolled ${dir} (wheel:${wheeled}, dom:${moved}); waited for lazy content`;
    }
  },
  hover: {
    description: 'Hover the mouse pointer over a selector',
    params: { selector: 'string?', ref: 'string?' },
    run: async (page, args) => {
      const el = await findActionElement(page, args.selector || (args.ref ? `[data-gpt-auth-ref="${args.ref}"]` : null));
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
      let key = args.key;
      if (key && key.includes('+')) {
        const parts = key.split('+');
        const last = parts[parts.length - 1];
        if (last && last.length === 1) {
          parts[parts.length - 1] = last.toLowerCase();
          key = parts.join('+');
        }
      }
      await page.keyboard.press(key);
      return `Pressed key "${key}"`;
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
    params: { selector: 'string?', ref: 'string?' },
    run: async (page, args) => {
      const el = await findActionElement(page, args.selector || (args.ref ? `[data-gpt-auth-ref="${args.ref}"]` : null) || 'body');
      if (el) {
        const text = await page.evaluate(e => e.innerText || e.textContent, el);
        return `Extracted text: ${String(text).slice(0, 20000)}`;
      }
      return `Element ${args.selector || 'body'} not found`;
    }
  },
  handle_login: {
    description: 'Handle login popups or OAuth windows',
    params: {},
    run: async (page, args, ctx) => {
      ctx.permissions = ctx.permissions || {};
      const permission = ctx.permissions.oauth_login || 'ask';
      if (permission === 'deny') return 'OAuth login blocked by permissions policy';
      if (permission === 'ask') {
        await enforceActionPermission(page, {
          type: 'click',
          selector: 'body',
          category: 'oauth_login',
          description: 'OAuth login handling'
        }, ctx);
      }
      const pages = typeof ctx.browser?.pages === 'function' ? await ctx.browser.pages().catch(() => []) : [];
      const candidates = pages.length ? pages : [page];
      const oauth = await handleOAuthPages(candidates, ctx.profile || {});
      if (oauth.handled) {
        await waitForStable(page);
        return `OAuth handled (${oauth.action})`;
      }
      for (const candidate of candidates) {
        const url = typeof candidate.url === 'function' ? candidate.url() : '';
        if (!/accounts\.google|login|oauth|signin|sso/i.test(url)) continue;
        const obs = await perceive(candidate).catch(() => null);
        const emailPattern = ctx.profile?.email
          ? new RegExp(String(ctx.profile.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : /continue|sign in/i;
        const preferred = obs?.elements?.find(el =>
          /button|link|option/.test(el.role) &&
          emailPattern.test(`${el.name} ${el.value || ''}`)
        ) || obs?.elements?.find(el =>
          /button|link/.test(el.role) && /continue|sign in|use another account|next/i.test(el.name)
        );
        if (preferred) {
          await executeSubagentAction(candidate, { type: 'click', selector: preferred.selector, ref: preferred.ref, category: 'oauth_login' }, ctx);
          await waitForStable(candidate);
          return `Clicked OAuth/account chooser control "${preferred.name}"`;
        }
      }
      return 'No OAuth popup actionable — use persistent browser profile or click account chooser manually';
    }
  },
  signature: {
    description: 'Draw a signature on a canvas element',
    params: { selector: 'string?', ref: 'string?' },
    run: async (page, args, ctx) => {
      await executeSubagentAction(page, { type: 'signature', selector: args.selector, ref: args.ref }, ctx);
      return `Drew signature on canvas ${args.selector || args.ref}`;
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
      for (const formAction of args.actions) {
        await executeSubagentAction(page, formAction, ctx);
      }
      return `Executed ${args.actions.length} form actions`;
    }
  }
};
