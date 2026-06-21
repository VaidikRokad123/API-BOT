import { isDropdownPlaceholder } from './dropdown.js';

// Install a click-listener tracker (browser-use style). Hooks
// EventTarget.addEventListener so any element that registers a click-ish handler
// is remembered in a WeakSet, queryable in-page via window.__gptHasClickListener.
// Catches React/Vue/Angular custom buttons (<div>/<span> with onClick) that have
// no button class/role. Cross-engine (init script, no CDP), no DOM mutation.
// Must be called once per page BEFORE navigation.
export async function installClickListenerTracker(page) {
  if (!page?.evaluateOnNewDocument) return;
  await page.evaluateOnNewDocument(() => {
    try {
      const CLICKY = new Set(['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']);
      const tracked = new WeakSet();
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, ...rest) {
        try { if (CLICKY.has(type) && this instanceof Element) tracked.add(this); } catch {}
        return orig.call(this, type, ...rest);
      };
      window.__gptHasClickListener = el => { try { return tracked.has(el); } catch { return false; } };
    } catch {}
  }).catch(() => {});
}

async function getFrameSelectorPath(frame) {
  if (!frame.parentFrame()) return '';
  try {
    const frameEl = await frame.frameElement();
    if (!frameEl) return '';
    const parentPath = await getFrameSelectorPath(frame.parentFrame());
    const localSelector = await frame.parentFrame().evaluate((el) => {
      if (el.id) return `iframe[id='${el.id}']`;
      if (el.name) return `iframe[name='${el.name}']`;
      if (el.src) {
        const cleanSrc = el.src.split('?')[0];
        return `iframe[src^='${cleanSrc}']`;
      }
      const siblings = Array.from(el.parentElement?.children || []).filter(c => c.tagName === 'IFRAME');
      return `iframe:nth-of-type(${siblings.indexOf(el) + 1})`;
    }, frameEl);
    return parentPath ? `${parentPath} >>> ${localSelector}` : localSelector;
  } catch {
    return '';
  }
}

async function findFrameAndElement(page, selector) {
  if (selector.includes(' >>> ')) {
    const parts = selector.split(' >>> ');
    let currentFrame = page.mainFrame ? page.mainFrame() : page;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        const element = await currentFrame.$(part).catch(() => null);
        return { frame: currentFrame, element };
      } else {
        const frameEl = await currentFrame.$(part).catch(() => null);
        if (frameEl) {
          currentFrame = await frameEl.contentFrame().catch(() => null);
        } else {
          return { frame: null, element: null };
        }
      }
    }
  }
  const element = await page.$(selector).catch(() => null);
  return { frame: page.mainFrame ? page.mainFrame() : page, element };
}

function scrapeFrameDOM() {
  function isVisible(node) {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           rect.width > 0 &&
           rect.height > 0 &&
           node.getAttribute('aria-hidden') !== 'true' &&
           !node.closest('[aria-hidden="true"]');
  }

  function getSelector(el) {
    const attrValue = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/\r/g, '\\d ').replace(/\n/g, '\\a ');
    const attrSelector = (attr, value) => `[${attr}='${attrValue(value)}']`;
    const unique = selector => {
      try {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === el;
      } catch {
        return false;
      }
    };
    const cssPath = () => {
      const parts = []; let cur = el;
      while (cur && cur !== document.body && parts.length < 5) {
        let tag = cur.tagName.toLowerCase();
        const siblings = Array.from(cur.parentElement?.children || []).filter(c => c.tagName === cur.tagName);
        if (siblings.length > 1) tag += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        parts.unshift(tag); cur = cur.parentElement;
      }
      return parts.join(' > ');
    };

    const fieldOwner = el.getAttribute('role') === 'combobox' && el.closest('[data-test-id]');
    const candidates = [];
    if (fieldOwner) candidates.push(`${attrSelector('data-test-id', fieldOwner.getAttribute('data-test-id'))} [role='combobox']`);
    if (el.getAttribute('data-test-id')) candidates.push(attrSelector('data-test-id', el.getAttribute('data-test-id')));
    if (el.id) candidates.push(attrSelector('id', el.id));
    if (el.getAttribute('data-testid')) candidates.push(attrSelector('data-testid', el.getAttribute('data-testid')));
    if (el.name && el.value && ['radio', 'checkbox'].includes((el.getAttribute('type') || '').toLowerCase())) {
      candidates.push(`${attrSelector('name', el.name)}${attrSelector('value', el.value)}`);
    }
    if (el.name) candidates.push(attrSelector('name', el.name));
    for (const selector of candidates) {
      if (unique(selector)) return selector;
    }
    return cssPath();
  }

  function getLabel(el) {
    const nativeLabel = Array.from(el.labels || [])[0] ||
      (el.id ? Array.from(document.querySelectorAll('label')).find(label => label.htmlFor === el.id) : null);
    if (nativeLabel) return nativeLabel.innerText.trim();
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '')
      .join(' ').trim();
    if (labelledBy) return labelledBy;
    const pl = el.closest('label');
    if (pl) return pl.innerText.replace(el.value || '', '').trim();
    const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name');
    if (aria) return aria;
    let cur = el.parentElement;
    for (let i = 0; i < 4 && cur; i++) {
      const sib = cur.previousElementSibling;
      if (sib && sib.innerText && sib.innerText.trim().length < 100) return sib.innerText.trim();
      for (const c of cur.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim()) return c.textContent.trim();
      }
      cur = cur.parentElement;
    }
    return '';
  }

  function getFieldHint(el, label) {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const parts = [];
    const attrs = [
      ['name', el.getAttribute('name')],
      ['id', el.getAttribute('id')],
      ['autocomplete', el.getAttribute('autocomplete')],
      ['aria', el.getAttribute('aria-label')],
      ['placeholder', el.getAttribute('placeholder')],
    ];
    for (const [key, value] of attrs) {
      const text = clean(value);
      if (text && text !== clean(label) && text.length <= 80) parts.push(`${key}:${text}`);
    }
    let cur = el.parentElement;
    for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) {
      const text = clean(cur.innerText || cur.textContent);
      if (text && text.length > clean(label).length && text.length <= 180) {
        parts.push(`context:${text}`);
        break;
      }
    }
    return [...new Set(parts)].slice(0, 4).join(' | ');
  }

  function getChoiceQuestion(el, optionLabel) {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const candidates = [];
    const add = nodeOrText => {
      const text = clean(typeof nodeOrText === 'string' ? nodeOrText : nodeOrText?.innerText || nodeOrText?.textContent);
      if (text && text.toLowerCase() !== clean(optionLabel).toLowerCase() && text.length <= 700) candidates.push(text);
    };

    const contextIds = `${el.getAttribute('aria-describedby') || ''} ${el.getAttribute('aria-labelledby') || ''}`
      .trim().split(/\s+/).filter(Boolean);
    contextIds.forEach(id => add(document.getElementById(id)));

    const group = el.name
      ? Array.from(document.querySelectorAll('input')).filter(input => input.name === el.name)
      : [el];
    let common = el.parentElement;
    while (common && !group.every(input => common.contains(input))) common = common.parentElement;

    let cursor = common;
    for (let depth = 0; depth < 5 && cursor; depth++, cursor = cursor.parentElement) {
      add(cursor.previousElementSibling);
      add(cursor.querySelector(':scope > legend, :scope > label, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > p'));
      add(cursor);
    }

    const unique = [...new Set(candidates)]
      .filter(text => !/^(?:yes|no|true|false)(?:\s+(?:yes|no|true|false))*$/i.test(text));
    return (unique.filter(text => text.includes('?')).sort((a, b) => a.length - b.length)[0] ||
      unique.filter(text => text.length >= 12).sort((a, b) => a.length - b.length)[0] || '').slice(0, 500);
  }

  function isPlaceholderOption(option) {
    if (!option) return true;
    const text = (option.textContent || option.label || '').replace(/\s+/g, ' ').trim();
    const value = String(option.value ?? '').trim().toLowerCase();
    return option.disabled || option.hidden ||
      value === '' || ['default', 'placeholder', 'null', '-1'].includes(value) ||
      /^(?:[-–—]+\s*)?(?:select|choose|pick)(?:\s+(?:an?|one|your))?(?:\s+option)?(?:\.{3}|…)?$/i.test(text) ||
      /^(?:please\s+)?select\b/i.test(text) || /^none selected$/i.test(text);
  }

  const fields = [];
  const checkboxGroupMap = {};
  const VIEWPORT_THRESHOLD = 1500;

  document.querySelectorAll('input, textarea, select').forEach(el => {
    const rawType = el.tagName.toLowerCase() === 'select' ? 'select'
      : (el.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(rawType)) return;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const isChoice = rawType === 'radio' || rawType === 'checkbox' || rawType === 'file';

    if (isChoice) {
      if (style.display === 'none' || style.visibility === 'hidden' ||
          el.getAttribute('aria-hidden') === 'true' ||
          el.closest('[aria-hidden="true"]')) {
        return;
      }
    } else {
      if (!isVisible(el)) return;
      if (style.position !== 'absolute' && style.position !== 'fixed') {
        if (rect.top > window.innerHeight + VIEWPORT_THRESHOLD || rect.bottom < -VIEWPORT_THRESHOLD) return;
      }
      if (rect.bottom < 0 || rect.right < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
        if (style.position === 'absolute' || style.position === 'fixed') {
          return;
        }
      }
    }

    const nameOrId = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('placeholder') || '')).toLowerCase();
    if (nameOrId.includes('recaptcha') || nameOrId.includes('captcha') || nameOrId.includes('hcaptcha') || nameOrId.includes('turnstile') || nameOrId.includes('g-recaptcha') || nameOrId.includes('cf-challenge')) return;

    const label = getLabel(el);
    if (rawType !== 'select' && !label && !el.name && !el.id) return;

    const selectedOption = rawType === 'select' ? el.options[el.selectedIndex] : null;
    const field = {
      label: label.replace(/\s+/g, ' ').trim(),
      type: rawType, selector: getSelector(el),
      required: el.required || el.getAttribute('aria-required') === 'true',
      disabled: el.disabled,
      currentValue: rawType === 'select' && isPlaceholderOption(selectedOption) ? '' : (el.value || ''),
      placeholder: el.getAttribute('placeholder') || '',
    };
    const hint = getFieldHint(el, field.label);
    if (hint) field.hint = hint;
    if (rawType === 'select') {
      field.options = Array.from(el.options).map(o => ({
        text: o.text.trim(), value: o.value,
        isPlaceholder: isPlaceholderOption(o),
      }));
    }
    if (rawType === 'radio' || rawType === 'checkbox') {
      field.checked = el.checked;
      field.question = getChoiceQuestion(el, field.label);
      if (el.name) {
        field.groupName = el.name;
        const g = document.querySelectorAll(`input[name="${el.name}"]`);
        if (g.length > 1) {
          if (!checkboxGroupMap[el.name]) {
            checkboxGroupMap[el.name] = Array.from(g).map(r => ({ value: r.value, checked: r.checked }));
          }
        }
      }
    }
    fields.push(field);
  });

  const tracked = new Set(fields.filter(f => f.type === 'select').map(f => f.selector));
  document.querySelectorAll('select').forEach(el => {
    const sel = getSelector(el);
    if (tracked.has(sel)) return;
    const ct = el.closest('div, p, td, li')?.innerText?.trim() || '';
    const lbl = ct.replace(el.options[el.selectedIndex]?.text || '', '').trim().slice(0, 80);
    fields.push({
      label: lbl || `Dropdown (${sel})`, type: 'select', selector: sel,
      required: el.required, disabled: el.disabled,
      currentValue: isPlaceholderOption(el.options[el.selectedIndex]) ? '' : (el.value || ''),
      options: Array.from(el.options).map(o => ({ text: o.text.trim(), value: o.value, isPlaceholder: isPlaceholderOption(o) })),
    });
    const hint = getFieldHint(el, lbl);
    if (hint) fields[fields.length - 1].hint = hint;
  });

  const customSel = '[role="combobox"], [aria-haspopup="listbox"], [aria-autocomplete="list"], input[list], [data-automation-id*="dropdown" i], [data-automation-id*="select" i]';
  document.querySelectorAll(customSel).forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return;
    if (el.querySelector('select')) return;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (rect.width === 0 || style.display === 'none' || style.visibility === 'hidden' ||
        el.getAttribute('aria-hidden') === 'true') return;

    if (style.position !== 'absolute' && style.position !== 'fixed') {
      if (rect.top > window.innerHeight + VIEWPORT_THRESHOLD || rect.bottom < -VIEWPORT_THRESHOLD) return;
    }

    const sel = getSelector(el);
    if (tracked.has(sel)) return;
    const existingIndex = fields.findIndex(field => field.selector === sel);
    if (existingIndex !== -1) fields.splice(existingIndex, 1);

    let listbox = null;
    const ctrlId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctrlId) listbox = document.getElementById(ctrlId);
    if (!listbox && el.getAttribute('list')) listbox = document.getElementById(el.getAttribute('list'));
    if (!listbox) listbox = el.closest('div, fieldset, label')?.querySelector('[role="listbox"], ul[class*="option"], ul[class*="menu"]');

    let opts = [];
    if (listbox) {
      opts = Array.from(listbox.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li[role="presentation"] > :first-child, li:not([role="presentation"]), option'))
        .map(o => (o.innerText || o.textContent || '').trim())
        .filter(t => t && t.length < 100);
    }
    opts = [...new Set(opts)];

    const label = getLabel(el) || el.getAttribute('aria-label') ||
      el.closest('div, label')?.querySelector('label')?.innerText?.trim() || `Dropdown (${sel})`;
    const activeId = el.getAttribute('aria-activedescendant');
    const activeText = activeId ? document.getElementById(activeId)?.textContent : '';
    const selectedChild = el.querySelector('[aria-selected="true"], [data-selected="true"]');
    const rawCurrent = el.value || el.getAttribute('aria-valuetext') || activeText ||
      selectedChild?.textContent || el.innerText || '';
    const cleaned = rawCurrent.trim()
      .replace(/^\d+\s+match(?:es)?\s+found\.?\s*/i, '')
      .replace(/^\d+\s+result(?:s)?\s*\.?\s*/i, '')
      .replace(/^no\s+results?\.?\s*/i, '')
      .trim();
    const isPlaceholderValue = !cleaned ||
      /^(?:[-–—]+\s*)?(?:select|choose|pick|search|please\s+(?:select|choose)|none\s*selected|select\s+an?\s+option|select\s+one|type\s+to\s+search)(?:\s*\.{3}|…)?$/i.test(cleaned);
    const cur = isPlaceholderValue ? '' : cleaned.slice(0, 80);

    fields.push({
      label: label.replace(/\s+/g, ' ').trim().slice(0, 80),
      type: 'select', selector: sel, custom: true,
      required: el.getAttribute('aria-required') === 'true',
      disabled: el.getAttribute('aria-disabled') === 'true',
      currentValue: cur,
      options: opts.map(t => ({ text: t, value: t, isPlaceholder: false })),
    });
    const hint = getFieldHint(el, label);
    if (hint) fields[fields.length - 1].hint = hint;
    tracked.add(sel);
  });

  const canvases = [];
  document.querySelectorAll('canvas').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 50 && r.height > 30) {
      const style = window.getComputedStyle(el);
      if (style.position !== 'absolute' && style.position !== 'fixed') {
        if (r.top > window.innerHeight + VIEWPORT_THRESHOLD || r.bottom < -VIEWPORT_THRESHOLD) return;
      }
      const lbl = el.closest('div')?.previousElementSibling?.innerText?.trim() || el.getAttribute('aria-label') || 'Signature Canvas';
      canvases.push({ type: 'canvas', label: lbl, selector: getSelector(el), width: Math.round(r.width), height: Math.round(r.height) });
    }
  });

  const buttons = [];
  const seenSelectors = new Set();

  const addBtn = (el) => {
    if (!isVisible(el)) return;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (style.position !== 'absolute' && style.position !== 'fixed') {
      if (rect.top > window.innerHeight + VIEWPORT_THRESHOLD || rect.bottom < -VIEWPORT_THRESHOLD) return;
    }
    const sel = getSelector(el);
    if (seenSelectors.has(sel)) return;
    const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 100) return;
    seenSelectors.add(sel);
    buttons.push({
      text,
      selector: sel,
      type: el.getAttribute('role') || el.getAttribute('type') || el.tagName.toLowerCase(),
      disabled: el.disabled || false
    });
  };

  document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(addBtn);
  document.querySelectorAll('[role="button"], [role="link"]').forEach(addBtn);
  document.querySelectorAll('[data-identifier], [data-email], [data-authuser]').forEach(addBtn);
  document.querySelectorAll('a').forEach(addBtn);

  document.querySelectorAll('div, span, p').forEach(el => {
    const text = (el.innerText || '').trim();
    if (!text || text.length > 50) return;
    const className = (el.className || '');
    const idName = (el.id || '');
    const style = window.getComputedStyle(el);
    const isPointer = style.cursor === 'pointer';
    const isButtonClass = /(?:^|\s|-|_)(?:btn|button|submit|action)(?:\s|-|_|$)/i.test(className + ' ' + idName);
    const isButtonText = /^(?:submit|apply|next|continue|confirm|save|finish|complete)\b/i.test(text);
    const isClickableClass = /(?:^|\s|-|_)(?:clickable|pointer|handler|trigger)(?:\s|-|_|$)/i.test(className + ' ' + idName);
    // Real JS click handler attached (React/Vue/Angular custom button)
    const hasListener = typeof window.__gptHasClickListener === 'function' && window.__gptHasClickListener(el);
    if (isButtonClass || isButtonText || isPointer || isClickableClass || hasListener) {
      addBtn(el);
    }
  });

  return {
    url: window.location.href, title: document.title,
    pageText: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 3000),
    fields: fields.slice(0, 160),
    checkboxGroups: checkboxGroupMap,
    canvases,
    buttons: buttons.slice(0, 100),
  };
}

export async function scrapePageState(page) {
  const combinedState = {
    url: page.url ? await page.url() : '',
    title: await page.title().catch(() => ''),
    pageText: '',
    fields: [],
    checkboxGroups: {},
    canvases: [],
    buttons: []
  };

  const frameStates = [];
  const allFrames = page.frames();

  for (const frame of allFrames) {
    try {
      const frameSelector = await getFrameSelectorPath(frame);
      const state = await frame.evaluate(scrapeFrameDOM).catch(() => null);
      if (state) {
        frameStates.push({ frameSelector, state });
      }
    } catch (e) {
      // Best-effort frame scraping
    }
  }

  for (const { frameSelector, state } of frameStates) {
    if (state.pageText) {
      combinedState.pageText += (combinedState.pageText ? ' ' : '') + state.pageText;
    }

    const prefixSelector = sel => frameSelector ? `${frameSelector} >>> ${sel}` : sel;

    for (const field of state.fields || []) {
      field.selector = prefixSelector(field.selector);
      combinedState.fields.push(field);
    }

    for (const [groupName, groupOptions] of Object.entries(state.checkboxGroups || {})) {
      const uniqueGroupName = frameSelector ? `${frameSelector}_${groupName}` : groupName;
      combinedState.checkboxGroups[uniqueGroupName] = groupOptions;
    }

    for (const canvas of state.canvases || []) {
      canvas.selector = prefixSelector(canvas.selector);
      combinedState.canvases.push(canvas);
    }

    for (const button of state.buttons || []) {
      button.selector = prefixSelector(button.selector);
      combinedState.buttons.push(button);
    }
  }

  combinedState.pageText = combinedState.pageText.slice(0, 3000);
  combinedState.fields = combinedState.fields.slice(0, 160);
  combinedState.buttons = combinedState.buttons.slice(0, 100);

  for (const field of combinedState.fields.filter(f => f.type === 'select' && !f.custom)) {
    field.options = (field.options || []).map(option => ({
      ...option,
      isPlaceholder: isDropdownPlaceholder(option),
    }));
    const selected = field.options.find(option => String(option.value) === String(field.currentValue));
    if (isDropdownPlaceholder(selected)) field.currentValue = '';
  }

  for (const field of combinedState.fields.filter(f => f.type === 'select' && f.custom && !f.disabled && !f.options?.length && !f.currentValue)) {
    try {
      const { frame: targetFrame, element: trigger } = await findFrameAndElement(page, field.selector);
      if (!trigger || !targetFrame) continue;
      await targetFrame.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }), trigger);
      await trigger.click();
      await new Promise(resolve => setTimeout(resolve, 800));

      const inspected = await targetFrame.evaluate(async (el) => {
        const isVisible = node => {
          if (!node) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        };
        const clean = text => (text || '').replace(/\s+/g, ' ').trim();
        const roots = [];
        const controlledIds = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`
          .trim().split(/\s+/).filter(Boolean);
        for (const id of controlledIds) {
          const root = document.getElementById(id);
          if (root) roots.push(root);
        }
        if (!roots.length) {
          const localRoot = el.closest('div, fieldset, label')?.querySelector('[role="listbox"], [role="menu"], [class*="menu" i], [class*="options" i]');
          if (localRoot) roots.push(localRoot);
        }
        if (!roots.length) {
          document.querySelectorAll('[role="listbox"], [role="menu"], [class*="select__menu" i], [data-automation-id*="menu" i]')
            .forEach(root => { if (isVisible(root)) roots.push(root); });
        }

        const optionSelector = '[role="option"], [role="menuitemradio"], [role="menuitem"], li[role="presentation"] > :first-child, option, li:not([role="presentation"]), [data-value], [data-option-index]';
        const seen = new Set();
        const options = [];
        let selectedText = '';
        const collect = candidates => {
          for (const option of candidates) {
            if (!isVisible(option) && !roots.some(root => root.contains(option))) continue;
            const text = clean(option.innerText || option.textContent || option.getAttribute('aria-label'));
            if (!text || text.length > 160) continue;
            if (option.getAttribute('aria-selected') === 'true' || option.selected) selectedText = text;
            if (seen.has(text)) continue;
            seen.add(text);
            options.push({
              text,
              value: option.getAttribute('data-value') || option.value || text,
              isPlaceholder: option.getAttribute('aria-disabled') === 'true' || option.disabled || false,
            });
          }
        };

        if (roots.length) {
          for (const root of [...new Set(roots)]) {
            const originalTop = root.scrollTop;
            let position = 0;
            for (let pass = 0; pass < 60; pass++) {
              root.scrollTop = position;
              await new Promise(resolve => setTimeout(resolve, 25));
              collect(Array.from(root.querySelectorAll(optionSelector)));
              const max = Math.max(0, root.scrollHeight - root.clientHeight);
              if (position >= max) break;
              position = Math.min(max, position + Math.max(80, root.clientHeight * 0.8));
            }
            root.scrollTop = originalTop;
          }
        } else {
          collect(Array.from(document.querySelectorAll('[role="option"], [data-option-index]')).filter(isVisible));
        }

        const activeId = el.getAttribute('aria-activedescendant');
        const active = activeId && document.getElementById(activeId);
        const currentValue = clean(el.value || el.getAttribute('aria-valuetext') ||
          selectedText || active?.innerText || active?.textContent);
        return { options, currentValue };
      }, trigger);

      if (inspected.options?.length) {
        field.options = inspected.options;
      } else {
        await new Promise(resolve => setTimeout(resolve, 700));
        const retry = await targetFrame.evaluate(async (el) => {
          const isVisible = node => {
            if (!node) return false;
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' &&
              style.opacity !== '0' && rect.width > 0 && rect.height > 0;
          };
          const clean = text => (text || '').replace(/\s+/g, ' ').trim();
          const roots = [];
          const controlledIds = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`
            .trim().split(/\s+/).filter(Boolean);
          for (const id of controlledIds) {
            const root = document.getElementById(id);
            if (root) roots.push(root);
          }
          if (!roots.length) {
            document.querySelectorAll('[role="listbox"], [role="menu"], [class*="select__menu" i], [data-automation-id*="menu" i]')
              .forEach(root => { if (isVisible(root)) roots.push(root); });
          }
          const optionSelector = '[role="option"], [role="menuitemradio"], [role="menuitem"], li[role="presentation"] > :first-child, option, li:not([role="presentation"]), [data-value], [data-option-index]';
          const seen = new Set();
          const options = [];
          for (const root of [...new Set(roots)]) {
            for (const option of root.querySelectorAll(optionSelector)) {
              const text = clean(option.innerText || option.textContent || option.getAttribute('aria-label'));
              if (!text || text.length > 160 || seen.has(text)) continue;
              seen.add(text);
              options.push({ text, value: option.getAttribute('data-value') || option.value || text, isPlaceholder: false });
            }
          }
          return options;
        }, trigger).catch(() => []);
        if (retry?.length) field.options = retry;
      }
      if (inspected.currentValue && !/^(?:select|choose|pick|search|please\s+(?:select|choose)|none selected)\b/i.test(inspected.currentValue)) {
        field.currentValue = inspected.currentValue.slice(0, 80);
      }
      await targetFrame.keyboard.press('Escape').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
      const stillOpen = await targetFrame.evaluate(el => el.getAttribute('aria-expanded') === 'true', trigger).catch(() => false);
      if (stillOpen) await trigger.click().catch(() => {});
    } catch {
      // Fallback
    }
  }

  if (typeof page.ariaSnapshot === 'function') {
    const snap = await page.ariaSnapshot().catch(() => null);
    if (snap) combinedState.ariaSnapshot = snap.slice(0, 6000);
  }

  return combinedState;
}
