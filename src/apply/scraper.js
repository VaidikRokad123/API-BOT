export async function scrapePageState(page) {
  return await page.evaluate(() => {

    function getSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.name) return `[name="${CSS.escape(el.name)}"]`;
      const parts = []; let cur = el;
      while (cur && cur !== document.body && parts.length < 4) {
        let tag = cur.tagName.toLowerCase();
        const siblings = Array.from(cur.parentElement?.children || []).filter(c => c.tagName === cur.tagName);
        if (siblings.length > 1) tag += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        parts.unshift(tag); cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    function getLabel(el) {
      if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return l.innerText.trim(); }
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

    // Form fields
    const fields = [];
    const checkboxGroupMap = {};
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const rawType = el.tagName.toLowerCase() === 'select' ? 'select'
        : (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(rawType)) return;
      const label = getLabel(el);
      if (rawType !== 'select' && !label && !el.name && !el.id) return;

      const field = {
        label: label.replace(/\s+/g, ' ').trim(),
        type: rawType, selector: getSelector(el),
        required: el.required || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled, currentValue: el.value || '',
        placeholder: el.getAttribute('placeholder') || '',
      };
      if (rawType === 'select') {
        field.options = Array.from(el.options).map(o => ({
          text: o.text.trim(), value: o.value,
          isPlaceholder: o.disabled || o.value === '' || o.value === 'default',
        }));
      }
      if (rawType === 'radio' || rawType === 'checkbox') {
        field.checked = el.checked;
        if (el.name) {
          field.groupName = el.name;
          const g = document.querySelectorAll(`input[name="${el.name}"]`);
          if (g.length > 1) {
            // Store group options in a deduplicated map (built below)
            if (!checkboxGroupMap[el.name]) {
              checkboxGroupMap[el.name] = Array.from(g).map(r => ({ value: r.value, checked: r.checked }));
            }
          }
        }
      }
      fields.push(field);
    });

    // Safety net: force-include all <select> elements
    const tracked = new Set(fields.filter(f => f.type === 'select').map(f => f.selector));
    document.querySelectorAll('select').forEach(el => {
      const sel = getSelector(el);
      if (tracked.has(sel)) return;
      const ct = el.closest('div, p, td, li')?.innerText?.trim() || '';
      const lbl = ct.replace(el.options[el.selectedIndex]?.text || '', '').trim().slice(0, 80);
      fields.push({
        label: lbl || `Dropdown (${sel})`, type: 'select', selector: sel,
        required: el.required, disabled: el.disabled, currentValue: el.value || '',
        options: Array.from(el.options).map(o => ({ text: o.text.trim(), value: o.value, isPlaceholder: o.disabled || o.value === '' })),
      });
    });

    // Canvases (signature pads)
    const canvases = [];
    document.querySelectorAll('canvas').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 30) {
        const lbl = el.closest('div')?.previousElementSibling?.innerText?.trim() || el.getAttribute('aria-label') || 'Signature Canvas';
        canvases.push({ type: 'canvas', label: lbl, selector: getSelector(el), width: Math.round(r.width), height: Math.round(r.height) });
      }
    });

    // Buttons
    const buttons = [];
    document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(el => {
      const text = (el.innerText || el.value || '').trim();
      if (!text) return;
      buttons.push({ text, selector: getSelector(el), type: el.getAttribute('type') || 'button', disabled: el.disabled });
    });

    return {
      url: window.location.href, title: document.title,
      pageText: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 3000),
      fields: fields.slice(0, 80),
      checkboxGroups: checkboxGroupMap,
      canvases,
      buttons: buttons.slice(0, 25),
    };
  });
}
