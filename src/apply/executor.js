import fs from 'fs';
import path from 'path';
import { findBestDropdownOption, findVerifiedDropdownValue, isDropdownPlaceholder, normalizeDropdownText } from './dropdown.js';
import { attributeSelector, idFromLegacySelector } from './selector.js';

let interactionSequence = 0;

function interactionMarker(kind) {
  interactionSequence += 1;
  return `gpt-auth-${kind}-${Date.now()}-${interactionSequence}`;
}

function actionSettleMs(type) {
  switch (type) {
    case 'select': return 1000;
    case 'check': return 800;
    case 'upload': return 1200;
    case 'click': return 900;
    case 'signature': return 700;
    default: return 350;
  }
}

async function findActionElement(page, selector) {
  const direct = await page.$(selector).catch(() => null);
  if (direct) return direct;
  const legacyId = idFromLegacySelector(selector);
  return legacyId ? page.$(attributeSelector('id', legacyId)).catch(() => null) : null;
}

async function clickChoiceControl(page, element) {
  const marker = interactionMarker('choice');
  const marked = await page.evaluate((input, token) => {
    const visible = node => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const explicitLabel = Array.from(input.labels || [])[0] ||
      (input.id ? Array.from(document.querySelectorAll('label')).find(label => label.htmlFor === input.id) : null);
    const candidates = [
      explicitLabel,
      input.closest('label'),
      input.closest('[role="radio"], [role="checkbox"]'),
      input,
    ];
    const target = candidates.find(visible) || candidates.find(Boolean);
    if (!target) return false;
    target.setAttribute('data-gpt-auth-click-target', token);
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }, element, marker);
  if (!marked) return false;

  const target = await page.$(`[data-gpt-auth-click-target='${marker}']`);
  let clicked = false;
  if (target) {
    try {
      await target.click();
      clicked = true;
    } catch {
      const box = await target.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        clicked = true;
      }
    }
  }
  await page.evaluate(token => {
    document.querySelector(`[data-gpt-auth-click-target='${token}']`)?.removeAttribute('data-gpt-auth-click-target');
  }, marker).catch(() => {});
  return clicked;
}

async function readChoiceState(page, selector) {
  const current = await findActionElement(page, selector);
  if (!current) return false;
  return page.evaluate(element => element.checked === true || element.getAttribute('aria-checked') === 'true' ||
    element.closest('[role="radio"], [role="checkbox"]')?.getAttribute('aria-checked') === 'true', current).catch(() => false);
}

async function readCustomSelection(page, selector) {
  const current = await findActionElement(page, selector);
  if (!current) return [];
  return page.evaluate(element => {
    const values = new Set();
    const add = value => {
      const clean = String(value || '').replace(/\s+/g, ' ').trim();
      if (clean) values.add(clean);
    };
    add(element.value);
    add(element.getAttribute('aria-valuetext'));
    add(element.innerText);
    const activeId = element.getAttribute('aria-activedescendant');
    if (activeId) add(document.getElementById(activeId)?.textContent);

    // react-select renders the committed label in a SIBLING of the
    // <input role=combobox> (e.g. .select__single-value), so we must search the
    // whole field wrapper — NOT closest('[class*=select]'), which stops at the
    // narrow .select__input-container that holds only the input. Prefer the
    // data-test-id/data-automation-id wrapper; else scan a few ancestor levels.
    const containers = [];
    const tagged = element.closest('[data-test-id], [data-automation-id]');
    if (tagged) containers.push(tagged);
    let node = element.parentElement;
    for (let i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
      containers.push(node);
    }
    const valueSelector = [
      '[aria-selected="true"]', '[data-selected="true"]',
      'input[type="hidden"]',
      '[class*="single-value" i]', '[class*="singleValue" i]', '[class*="single_value" i]',
      '[class*="selected" i]', '[class*="title" i]', '[class*="value" i]',
    ].join(', ');
    for (const container of new Set(containers)) {
      container.querySelectorAll(valueSelector).forEach(n => {
        if (n === element) return;        // skip the search input (blank after commit)
        add(n.value);
        add(n.getAttribute('aria-valuetext'));
        add(n.getAttribute('aria-label'));
        add(n.innerText);
        add(n.textContent);
      });
    }
    return [...values];
  }, current).catch(() => []);
}

export async function drawSignature(page, selector) {
  try {
    let canvas = await page.$(selector);
    if (!canvas) canvas = await page.$('canvas');
    if (!canvas) return;
    const box = await canvas.boundingBox();
    if (!box) return;

    const cx = box.x + box.width * 0.15, cy = box.y + box.height * 0.55;
    const w  = box.width * 0.7,          h  = box.height * 0.35;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const pts = [
      [0.00,0.0],[0.05,-0.8],[0.10,-1.0],[0.15,-0.8],[0.18,0.0],
      [0.22,0.3],[0.27,-0.6],[0.32,-0.9],[0.37,-0.6],[0.40,0.0],
      [0.45,0.4],[0.50,-0.5],[0.55,-0.8],[0.60,-0.5],[0.63,0.0],
      [0.68,0.3],[0.73,-0.4],[0.78,-0.7],[0.83,-0.4],[0.88,0.0],
      [0.93,0.2],[0.97,0.1],[1.00,0.0],
    ];
    for (const [px, py] of pts) await page.mouse.move(cx + px * w, cy + py * h, { steps: 3 });
    await page.mouse.move(cx, cy + h * 0.5);
    await page.mouse.move(cx + w, cy + h * 0.5, { steps: 20 });
    await page.mouse.up();
    console.log('    ✓ Signature drawn');
  } catch (e) {
    console.log(`    ⚠ Signature: ${e.message.split('\n')[0]}`);
  }
}

export async function executeAction(page, action, profile) {
  const lbl = action.description || action.selector;
  console.log(`  [${action.type.toUpperCase()}] ${lbl}`);

  try {
    switch (action.type) {

      case 'fill': {
        const el = await findActionElement(page, action.selector);
        if (!el) { console.log('    ⚠ Not found'); break; }
        const isDisabled = await page.evaluate(e => e.disabled, el);
        if (isDisabled) { console.log('    ⚠ Disabled'); break; }

        const elType = await page.evaluate(e => (e.getAttribute('type') || e.tagName).toLowerCase(), el);
        if (elType === 'checkbox' || elType === 'radio') {
          console.log(`    ↻ Element is a ${elType}, redirecting to check`);
          if (!await readChoiceState(page, action.selector)) await clickChoiceControl(page, el);
          await new Promise(resolve => setTimeout(resolve, 800));
          console.log(await readChoiceState(page, action.selector)
            ? '    → Checked ✓'
            : '    ⚠ Choice did not change after click');
          break;
        }
        if (elType === 'file') {
          console.log('    ⚠ Cannot fill a file input — use upload action instead');
          break;
        }

        // Resolve credential tokens. Match loosely (case-insensitive, underscores
        // optional) so an AI that drops the __ never types the literal token text.
        let fillValue = action.value;
        const tok = String(fillValue || '').toLowerCase().replace(/_/g, '');
        if (tok === 'googleemail') {
          fillValue = profile.credentials?.google?.username || profile.email;
        } else if (tok === 'googlepassword') {
          fillValue = profile.credentials?.google?.password || '';
        } else if (tok === 'defaultusername') {
          fillValue = profile.credentials?.default?.username || '';
        } else if (tok === 'defaultpassword') {
          fillValue = profile.credentials?.default?.password || '';
        }

        const currentVal = await page.evaluate(e => e.value, el).catch(() => '');
        
        const isPhone = elType === 'tel' || 
          /(phone|mobile|tel|contact|telephone)/i.test(action.selector + ' ' + (action.description || '') + ' ' + (action.value || ''));
        const normalizePhone = val => String(val || '').replace(/\D/g, '');

        if (isPhone) {
          const normCurrent = normalizePhone(currentVal);
          const normFill = normalizePhone(fillValue);
          if (normCurrent && normFill && (normCurrent === normFill || normCurrent.endsWith(normFill) || normFill.endsWith(normCurrent))) {
            console.log(`    → already filled with correct phone value "${currentVal}" ✓`);
            break;
          }
        } else if (currentVal && String(currentVal).trim().toLowerCase() === String(fillValue).trim().toLowerCase()) {
          console.log(`    → already filled with correct value "${fillValue}" ✓`);
          break;
        }

        // Check if this input is part of a number counter (+ / - buttons)
        const isCounter = await page.evaluate(e => {
          const parent = e.parentElement;
          if (!parent) return false;
          const buttons = Array.from(parent.querySelectorAll('button'));
          const hasMinus = buttons.some(b => /[-−—]/i.test(b.innerText || b.textContent || '') || b.getAttribute('aria-label')?.includes('decrease') || b.getAttribute('aria-label')?.includes('decrement'));
          const hasPlus = buttons.some(b => /[+]/i.test(b.innerText || b.textContent || '') || b.getAttribute('aria-label')?.includes('increase') || b.getAttribute('aria-label')?.includes('increment'));
          return hasMinus && hasPlus;
        }, el).catch(() => false);

        if (isCounter && !isNaN(parseInt(fillValue))) {
          const target = parseInt(fillValue);
          
          // 1. Try native React state updater bypass first
          await page.evaluate((input, val) => {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (nativeSetter) {
              nativeSetter.call(input, val);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              input.value = val;
            }
          }, el, String(fillValue || '')).catch(() => {});
          
          await new Promise(r => setTimeout(r, 150));
          let currentValue = parseInt(await page.evaluate(e => e.value, el)) || 0;
          console.log(`    → Detected counter widget. Native set value: ${currentValue}, Target: ${target}`);
          
          // 2. Fallback to increment/decrement buttons if native setter is ignored
          if (currentValue !== target) {
            let attempts = 0;
            const maxAttempts = 100; // safety ceiling
            
            while (currentValue !== target && attempts < maxAttempts) {
              attempts++;
              const diff = target - currentValue;
              const clickType = diff > 0 ? 'plus' : 'minus';
              
              const buttonHandle = await page.evaluateHandle((e, type) => {
                const parent = e.parentElement;
                const buttons = Array.from(parent.querySelectorAll('button'));
                if (type === 'plus') {
                  return buttons.find(b => /[+]/i.test(b.innerText || b.textContent || '') || b.getAttribute('aria-label')?.includes('increase') || b.getAttribute('aria-label')?.includes('increment'));
                } else {
                  return buttons.find(b => /[-−—]/i.test(b.innerText || b.textContent || '') || b.getAttribute('aria-label')?.includes('decrease') || b.getAttribute('aria-label')?.includes('decrement'));
                }
              }, el, clickType).catch(() => null);
              
              const btn = buttonHandle ? buttonHandle.asElement() : null;
              if (btn) {
                await btn.click().catch(() => {});
                await new Promise(r => setTimeout(r, 150)); // small delay for UI transition
                const nextValue = parseInt(await page.evaluate(e => e.value, el)) || 0;
                if (nextValue === currentValue) {
                  console.log(`    ⚠ Value stuck at ${currentValue} after clicking ${clickType}`);
                  break;
                }
                currentValue = nextValue;
              } else {
                console.log(`    ⚠ Counter button for ${clickType} not found`);
                break;
              }
            }
          }
          console.log(`    → Counter set to ${currentValue}`);
        } else {
          await el.click().catch(() => {});
          // Select all text and backspace using keyboard to notify modern UI frameworks (React/Vue/etc.)
          await page.keyboard.down('Control').catch(() => {});
          await page.keyboard.press('A').catch(() => {});
          await page.keyboard.up('Control').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          // Fallback clear in DOM (handles non-focused elements)
          await page.evaluate(e => { e.value = ''; }, el).catch(() => {});

          await el.type(String(fillValue || ''));
          console.log(`    → "${String(fillValue || '').slice(0, 80)}"`);
        }
        break;
      }

      case 'select': {
        const el = await findActionElement(page, action.selector);
        if (!el) { console.log('    ⚠ Not found'); break; }
        const tag = await page.evaluate(e => e.tagName.toLowerCase(), el);

        if (tag === 'select') {
          const selectedText = await page.evaluate(s => s.options[s.selectedIndex]?.text?.trim() || '', el).catch(() => '');
          const selectedValue = await page.evaluate(s => s.value, el).catch(() => '');
          const target = String(action.value).toLowerCase().trim();
          if (selectedText.toLowerCase() === target || selectedValue.toLowerCase() === target) {
            console.log(`    → dropdown already set to "${selectedText}" ✓`);
            await new Promise(r => setTimeout(r, 600));
            break;
          }

          const allOpts = (await page.evaluate(s => Array.from(s.options).map(o => ({
            text: o.text.trim(), value: o.value, disabled: o.disabled, hidden: o.hidden,
          })), el)).map(option => ({ ...option, isPlaceholder: isDropdownPlaceholder(option) }));
          const match = findBestDropdownOption(allOpts, action.value);

          if (match) {
            await el.select(match.value);
            await new Promise(r => setTimeout(r, 1200));
            const selected = await page.evaluate(s => ({
              value: s.value,
              text: s.options[s.selectedIndex]?.text?.trim() || '',
            }), el);
            if (selected.value === match.value || normalizeDropdownText(selected.text) === normalizeDropdownText(match.text)) {
              console.log(`    → selected "${selected.text}" ✓`);
            } else {
              console.log(`    ⚠ Dropdown rejected "${match.text}" (still "${selected.text}")`);
            }
          } else {
            const available = allOpts.filter(o => !o.isPlaceholder && !o.disabled).map(o => o.text).slice(0, 8);
            console.log(`    ⚠ "${action.value}" is not an unambiguous option. Available: ${available.join(', ')}`);
          }
        } else {
          const datalistOptions = await page.evaluate(e => {
            const list = e.getAttribute('list') && document.getElementById(e.getAttribute('list'));
            return list ? Array.from(list.options || []).map(o => ({ text: o.label || o.value, value: o.value })) : [];
          }, el);
          if (datalistOptions.length) {
            const match = findBestDropdownOption(datalistOptions, action.value);
            if (!match) {
              console.log(`    ⚠ "${action.value}" is not an unambiguous datalist option.`);
              break;
            }
            await el.click().catch(() => {});
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await el.type(String(match.value));
            await page.keyboard.press('Tab');
            const actual = await page.evaluate(e => e.value, el);
            console.log(actual === String(match.value)
              ? `    → selected "${match.text}" ✓`
              : `    ⚠ Datalist rejected "${match.text}"`);
            break;
          }

          // Inspect only the opened widget/listbox. Searching arbitrary divs and
          // spans can click a matching word elsewhere on the application page.
          const currentText = await page.evaluate(e => (e.innerText || e.value || '').trim(), el).catch(() => '');
          const target = String(action.value).toLowerCase().trim();
          const normCurrent = currentText.toLowerCase().replace(/[^a-z0-9]/g, ' ');
          const normTarget = target.toLowerCase().replace(/[^a-z0-9]/g, ' ');
          if (normCurrent.includes(normTarget)) {
            console.log(`    → custom dropdown already set to "${action.value}" ✓`);
            await new Promise(r => setTimeout(r, 600));
            break;
          }

          await page.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'nearest' }), el);
          await el.click().catch(() => {});
          await new Promise(r => setTimeout(r, 700));

          const findVisibleOption = () => {
            const marker = interactionMarker('option');
            return page.evaluate(async (trigger, requested, token) => {
            const normalize = value => String(value || '').normalize('NFKD')
              .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
              .replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
            const visible = node => {
              if (!node) return false;
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                style.opacity !== '0' && rect.width > 0 && rect.height > 0;
            };
            const roots = [];
            const ids = `${trigger.getAttribute('aria-controls') || ''} ${trigger.getAttribute('aria-owns') || ''}`
              .trim().split(/\s+/).filter(Boolean);
            ids.forEach(id => { const root = document.getElementById(id); if (root) roots.push(root); });
            if (!roots.length) {
              const local = trigger.closest('div, fieldset, label')?.querySelector('[role="listbox"], [role="menu"], [class*="menu" i], [class*="options" i]');
              if (local) roots.push(local);
            }
            if (!roots.length) {
              document.querySelectorAll('[role="listbox"], [role="menu"], [class*="select__menu" i], [data-automation-id*="menu" i]')
                .forEach(root => { if (visible(root)) roots.push(root); });
            }

            // Microsoft wraps each real menu item in <li role="presentation">.
            // Never click that inert wrapper; target its interactive descendant.
            const selector = '[role="option"], [role="menuitemradio"], [role="menuitem"], li[role="presentation"] > :first-child, option, li:not([role="presentation"]), [data-value], [data-option-index]';
            const clickableNode = node => node.matches('[role="option"], [role="menuitemradio"], [role="menuitem"], button, a')
              ? node
              : node.querySelector('[role="option"], [role="menuitemradio"], [role="menuitem"], button, a, [tabindex]') || node;
            const nodes = [...new Set((roots.length
              ? roots.flatMap(root => Array.from(root.querySelectorAll(selector)))
              : Array.from(document.querySelectorAll('[role="option"], [data-option-index]')).filter(visible))
              .map(clickableNode))]
              .filter(node => visible(node) && node.getAttribute('aria-disabled') !== 'true' && !node.disabled);
            const target = normalize(requested);
            const details = nodes.map(node => ({
              node,
              text: (node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
              value: node.getAttribute('data-value') || node.value || '',
            })).filter(item => item.text);

            const choose = (items, allowBoundary = target.length >= 4) => {
              let chosen = items.find(item => normalize(item.text) === target)
                || items.find(item => normalize(item.value) === target);
              if (!chosen) {
                const stripped = items.filter(item => normalize(item.text.replace(/\s*[([][^)\]]*[)\]]\s*$/g, '')) === target);
                if (stripped.length === 1) chosen = stripped[0];
              }
              if (!chosen && allowBoundary) {
                const boundary = items.filter(item => {
                  const text = normalize(item.text);
                  return text.startsWith(`${target} `) || target.startsWith(`${text} `);
                });
                if (boundary.length === 1) chosen = boundary[0];
              }
              if (!chosen) {
                const containing = items.filter(item => {
                  const text = normalize(item.text);
                  const val = normalize(item.value);
                  return text.includes(target) || val.includes(target) || (target.length >= 2 && (target.includes(text) || target.includes(val)));
                });
                if (containing.length === 1) chosen = containing[0];
              }
              return chosen;
            };
            let match = choose(details);

            // A virtualized menu only mounts a few options at a time. Search it
            // page by page, using exact matching so an off-screen value is safe.
            if (!match) {
              for (const root of [...new Set(roots)]) {
                const originalTop = root.scrollTop;
                let position = 0;
                for (let pass = 0; pass < 60; pass++) {
                  root.scrollTop = position;
                  await new Promise(resolve => setTimeout(resolve, 25));
                  const mounted = [...new Set(Array.from(root.querySelectorAll(selector)).map(clickableNode))]
                    .filter(node => visible(node) && node.getAttribute('aria-disabled') !== 'true' && !node.disabled)
                    .map(node => ({
                      node,
                      text: (node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
                      value: node.getAttribute('data-value') || node.value || '',
                    })).filter(item => item.text);
                  match = choose(mounted, false);
                  if (match) break;
                  const max = Math.max(0, root.scrollHeight - root.clientHeight);
                  if (position >= max) break;
                  position = Math.min(max, position + Math.max(80, root.clientHeight * 0.8));
                }
                if (match) break;
                root.scrollTop = originalTop;
              }
            }
            if (!match) return { found: false, options: details.map(item => item.text).slice(0, 12) };

            match.node.scrollIntoView({ block: 'nearest' });
            match.node.setAttribute('data-gpt-auth-option-target', token);
            return { found: true, marker: token, text: match.text };
            }, el, String(action.value ?? ''), marker);
          };

          const activateOption = async found => {
            if (!found.found) return { ...found, clicked: false };
            const option = await page.$(`[data-gpt-auth-option-target='${found.marker}']`);
            if (!option) return { ...found, clicked: false };
            let clicked = false;
            try {
              // ElementHandle.click/WebElement.click sends real pointer events,
              // which controlled React widgets require to commit their state.
              await option.click();
              clicked = true;
            } catch {
              const box = await option.boundingBox().catch(() => null);
              if (box) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                clicked = true;
              }
            }
            await page.evaluate(token => {
              document.querySelector(`[data-gpt-auth-option-target='${token}']`)?.removeAttribute('data-gpt-auth-option-target');
            }, found.marker).catch(() => {});
            return { ...found, clicked };
          };

          let result = await activateOption(await findVisibleOption());
          const isEditable = !result.clicked && await page.evaluate(
            e => e.tagName === 'INPUT' || e.getAttribute('contenteditable') === 'true', el
          );
          if (isEditable) {
            // Searchable comboboxes may render matches only after text input.
            await el.click().catch(() => {});
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await el.type(String(action.value ?? ''));
            await new Promise(r => setTimeout(r, 700));
            result = await activateOption(await findVisibleOption());
          }

          if (result.clicked) {
            await new Promise(r => setTimeout(r, 900));
            const actualValues = await readCustomSelection(page, action.selector);
            const verifiedValue = findVerifiedDropdownValue(actualValues, result.text);
            if (verifiedValue) {
              console.log(`    → selected "${result.text}" (now "${verifiedValue}") ✓`);
            } else {
              // The option WAS clicked. Do NOT press Escape — on a react-select
              // widget that would revert a value we just committed but couldn't
              // read back. Trust the click and let the next scrape confirm.
              console.log(`    → clicked "${result.text}" (display not verifiable; left as-is)`);
            }
          } else {
            await page.keyboard.press('Escape').catch(() => {});
            console.log(`    ⚠ No unambiguous visible option for "${action.value}". Available: ${(result.options || []).join(', ')}`);
          }
        }
        break;
      }

      case 'click': {
        let el = await findActionElement(page, action.selector);
        if (!el) {
          let searchText = action.description || action.value || '';
          const ctok = String(searchText).toLowerCase().replace(/_/g, '');
          if (ctok === 'googleemail') {
            searchText = profile.credentials?.google?.username || profile.email;
          } else if (ctok === 'defaultusername') {
            searchText = profile.credentials?.default?.username || '';
          }

          el = await page.evaluateHandle((text) => {
            if (!text) return null;
            const lowerText = text.toLowerCase().trim();
            const visible = node => {
              if (!node) return false;
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                style.opacity !== '0' && rect.width > 0 && rect.height > 0;
            };
            const cleanText = node => (node.innerText || node.value || node.getAttribute?.('aria-label') || node.getAttribute?.('title') || '')
              .replace(/\s+/g, ' ').trim().toLowerCase();
            const textMatches = node => cleanText(node).includes(lowerText);

            // 1. Search standard clickable tags (buttons, links, inputs)
            const standardElements = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
            const match1 = standardElements.find(b => visible(b) && textMatches(b));
            if (match1) return match1;

            // 2. Search role="button" or role="link"
            const roleElements = Array.from(document.querySelectorAll('[role="button"], [role="link"], [role="menuitem"], [role="option"]'));
            const match2 = roleElements.find(b => visible(b) && textMatches(b));
            if (match2) return match2;

            // 3. Labels are a safe fallback for hidden checkbox/radio/file inputs.
            const label = Array.from(document.querySelectorAll('label')).find(l => visible(l) && textMatches(l));
            if (label) return label;

            // 4. Last resort: custom interactive elements only. Never click
            // arbitrary text containers, which often selects the wrong text on
            // dense ATS forms.
            const customInteractive = Array.from(document.querySelectorAll('[tabindex], [onclick], [data-testid], [data-test-id], [data-automation-id]'))
              .filter(e => visible(e) && textMatches(e));
            customInteractive.sort((a, b) => cleanText(a).length - cleanText(b).length);
            if (customInteractive.length > 0) return customInteractive[0];

            return null;
          }, searchText);
          if (el && !el.asElement()) el = null;
        }

        if (!el) { console.log('    ⚠ Not found'); break; }

        await page.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'nearest' }), el);

        // If element text suggests a file upload, intercept the native file chooser
        const _pdf = profile.resumePdfPath;
        const _looksUpload = _pdf && fs.existsSync(_pdf) && await page.evaluate(e => {
          const txt = ((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).toLowerCase();
          return /upload|attach|browse|choose file|select file|add resume|add cv/i.test(txt);
        }, el).catch(() => false);

        // Must register BEFORE the click that opens the dialog
        const _chooserP = _looksUpload
          ? page.waitForFileChooser({ timeout: 5000 }).catch(() => null)
          : Promise.resolve(null);

        await el.click();

        const _chooser = await _chooserP;
        if (_chooser) {
          await _chooser.accept([_pdf]);
          console.log(`    → File chooser auto-accepted: ${path.basename(_pdf)}`);
          await new Promise(r => setTimeout(r, 1200));
        } else {
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 1200));
        }
        break;
      }

      case 'check': {
        const el = await findActionElement(page, action.selector);
        if (!el) { console.log('    ⚠ Not found'); break; }
        const isChecked = await readChoiceState(page, action.selector);
        if (isChecked) {
          console.log('    → already checked ✓');
          await new Promise(r => setTimeout(r, 600));
          break;
        }
        await clickChoiceControl(page, el);
        await new Promise(resolve => setTimeout(resolve, 1200));
        console.log(await readChoiceState(page, action.selector)
          ? '    → Checked ✓'
          : '    ⚠ Choice did not change after click');
        break;
      }

      case 'upload': {
        const pdfPath = profile.resumePdfPath;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          console.log(`    ⚠ Resume PDF not found: ${pdfPath}`);
          console.log('    → Set "resumePdfPath" in data/profile.json');
          break;
        }

        // 1. Direct <input type="file"> — fastest path
        let fileInput = await findActionElement(page, action.selector);
        const isDirectFile = fileInput && await page.evaluate(
          e => e.tagName === 'INPUT' && (e.getAttribute('type') || '').toLowerCase() === 'file',
          fileInput
        ).catch(() => false);

        if (!isDirectFile) {
          // Try any file input on the page (may be hidden behind a styled button)
          fileInput = await page.$('input[type="file"]').catch(() => null);
        }

        if (fileInput) {
          await fileInput.uploadFile(pdfPath);
          console.log(`    → Uploaded: ${path.basename(pdfPath)}`);
          break;
        }

        // 2. No <input type="file"> visible — button opens native file dialog
        // Must register listener BEFORE the click that opens the dialog
        console.log('    → No file input found — intercepting native file chooser...');
        const chooserPromise = page.waitForFileChooser({ timeout: 8000 }).catch(() => null);

        const trigger = await findActionElement(page, action.selector);
        if (trigger) {
          await trigger.click().catch(() => {});
        } else {
          // Last resort: find any upload-labelled button
          const coords = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, [role="button"], label, a'));
            const match = els.find(e => {
              const txt = (e.innerText || e.getAttribute('aria-label') || '').toLowerCase();
              const rect = e.getBoundingClientRect();
              return /upload|attach|browse|choose file|select file|add resume|add cv/i.test(txt) && rect.width > 0;
            });
            if (!match) return null;
            const r = match.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }).catch(() => null);
          if (coords) await page.mouse.click(coords.x, coords.y);
        }

        const chooser = await chooserPromise;
        if (chooser) {
          await chooser.accept([pdfPath]);
          console.log(`    → File chooser accepted: ${path.basename(pdfPath)}`);
        } else {
          console.log('    ⚠ File chooser did not open — may need manual upload');
        }
        break;
      }

      case 'signature': {
        await drawSignature(page, action.selector);
        break;
      }

      default: console.log(`    ⚠ Unknown action: ${action.type}`);
    }

    await new Promise(r => setTimeout(r, actionSettleMs(action.type)));
  } catch (e) {
    console.log(`    ✗ ${e.message.split('\n')[0]}`);
  }
}

export async function autoHandleSpecials(page, pageState, profile) {
  // 1. Credentials Auto-Login
  if (profile.credentials) {
    const url = page.url ? await page.url() : await page.evaluate(() => window.location.href);

    // Google Sign-In helper
    if (url.includes('accounts.google.com') && profile.credentials.google) {
      const emailInput = await page.$('input[type="email"]');
      if (emailInput) {
        const val = await page.evaluate(e => e.value, emailInput);
        if (!val) {
          await emailInput.click();
          await page.keyboard.type(profile.credentials.google.username);
          const nextBtn = await page.$('#identifierNext button, button');
          if (nextBtn) await nextBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        const val = await page.evaluate(e => e.value, passwordInput);
        if (!val) {
          await passwordInput.click();
          await page.keyboard.type(profile.credentials.google.password);
          const nextBtn = await page.$('#passwordNext button, button');
          if (nextBtn) await nextBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } else {
      // Standard Login Page helper
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        const isPassEmpty = await page.evaluate(e => !e.value, passwordInput);
        if (isPassEmpty) {
          // Find preceding username/email input
          const usernameInput = await page.$('input[type="email"], input[name*="user"], input[name*="login"], input[type="text"]');
          if (usernameInput) {
            const isUserEmpty = await page.evaluate(e => !e.value, usernameInput);
            if (isUserEmpty && profile.credentials.default?.username) {
              await usernameInput.click();
              await page.keyboard.type(profile.credentials.default.username);
            }
          }
          if (profile.credentials.default?.password) {
            await passwordInput.click();
            await page.keyboard.type(profile.credentials.default.password);
          }
        }
      }
    }
  }

  // 2. Existing File/Checkbox auto-handlers
  for (const f of pageState.fields) {
    if (f.type === 'file' && !f.currentValue)
      await executeAction(page, { type: 'upload', selector: f.selector, description: f.label }, profile);
    if (f.type === 'checkbox' && !f.checked) {
      const lbl = f.label.toLowerCase();
      if (lbl.includes('agree') || lbl.includes('accept') || lbl.includes('terms') || lbl.includes('condition'))
        await executeAction(page, { type: 'check', selector: f.selector, description: f.label }, profile);
    }
  }
  for (const c of pageState.canvases)
    await drawSignature(page, c.selector);
}
