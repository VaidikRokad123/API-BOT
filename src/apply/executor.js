import fs from 'fs';
import path from 'path';

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
        const el = await page.$(action.selector);
        if (!el) { console.log('    ⚠ Not found'); break; }
        const isDisabled = await page.evaluate(e => e.disabled, el);
        if (isDisabled) { console.log('    ⚠ Disabled'); break; }

        const elType = await page.evaluate(e => (e.getAttribute('type') || e.tagName).toLowerCase(), el);
        if (elType === 'checkbox' || elType === 'radio') {
          console.log(`    ↻ Element is a ${elType}, redirecting to check`);
          const isChecked = await page.evaluate(e => e.checked, el);
          if (!isChecked) await el.click();
          console.log('    → Checked ✓');
          break;
        }
        if (elType === 'file') {
          console.log('    ⚠ Cannot fill a file input — use upload action instead');
          break;
        }

        await el.click().catch(() => {});
        await page.evaluate(e => { e.value = ''; }, el);
        await el.type(String(action.value || ''));
        console.log(`    → "${String(action.value || '').slice(0, 80)}"`);
        break;
      }

      case 'select': {
        const el = await page.$(action.selector);
        if (!el) { console.log('    ⚠ Not found'); break; }
        const tag = await page.evaluate(e => e.tagName.toLowerCase(), el);

        if (tag === 'select') {
          const allOpts = await page.evaluate(s => Array.from(s.options).map(o => ({ text: o.text.trim(), value: o.value })), el);
          const target  = String(action.value).toLowerCase().trim();
          let match = allOpts.find(o => o.text.toLowerCase() === target)
                   || allOpts.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()))
                   || allOpts.find(o => o.value.toLowerCase() === target);
          
          if (match) {
            await el.select(match.value);
            console.log(`    → selected "${match.text}"`);
          } else {
            // Attempt DOM selection fallback
            await page.evaluate((selectEl, val) => {
              const opt = Array.from(selectEl.options).find(o => o.text.trim() === val || o.value === val);
              if (opt) {
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, el, action.value);
            console.log(`    → attempted "${action.value}"`);
          }
        } else {
          // Custom dropdown handling
          await el.click().catch(() => {});
          await new Promise(r => setTimeout(r, 500));
          const target = String(action.value).toLowerCase().trim();

          const clicked = await page.evaluate((tgt) => {
            const selectorList = ['[role="option"]', 'li', '[class*="option"]', 'div', 'span'];
            for (const selector of selectorList) {
              const items = Array.from(document.querySelectorAll(selector));
              const match = items.find(item => item.innerText.toLowerCase().includes(tgt));
              if (match) {
                match.click();
                return true;
              }
            }
            const all = Array.from(document.querySelectorAll('a, button, p, span, div'));
            const fallbackMatch = all.find(item => item.innerText.toLowerCase().includes(tgt));
            if (fallbackMatch) {
              fallbackMatch.click();
              return true;
            }
            return false;
          }, target);

          if (clicked) {
            console.log(`    → custom dropdown "${action.value}"`);
          } else {
            console.log(`    ⚠ Could not click option for "${action.value}"`);
          }
        }
        break;
      }

      case 'click': {
        let el = await page.$(action.selector);
        if (!el) {
          el = await page.evaluateHandle((text) => {
            if (!text) return null;
            const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
            return buttons.find(b => (b.innerText || b.value || '').toLowerCase().includes(text.toLowerCase())) || null;
          }, action.description || '');
          if (el && !el.asElement()) el = null;
        }

        if (!el) { console.log('    ⚠ Not found'); break; }
        
        await page.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'nearest' }), el);
        await el.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));
        break;
      }

      case 'check': {
        const el = await page.$(action.selector);
        if (!el) { console.log('    ⚠ Not found'); break; }
        const isChecked = await page.evaluate(e => e.checked, el);
        if (!isChecked) await el.click();
        console.log('    → Checked ✓');
        break;
      }

      case 'upload': {
        let el = await page.$(action.selector);
        if (!el) el = await page.$('input[type="file"]');
        if (!el) { console.log('    ⚠ No file input'); break; }
        const pdfPath = profile.resumePdfPath;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          console.log(`    ⚠ Resume PDF not found: ${pdfPath}`);
          console.log('    → Set "resumePdfPath" in data/profile.json');
          break;
        }
        await el.uploadFile(pdfPath);
        console.log(`    → Uploaded: ${path.basename(pdfPath)}`);
        break;
      }

      case 'signature': {
        await drawSignature(page, action.selector);
        break;
      }

      default: console.log(`    ⚠ Unknown action: ${action.type}`);
    }

    await new Promise(r => setTimeout(r, 250));
  } catch (e) {
    console.log(`    ✗ ${e.message.split('\n')[0]}`);
  }
}

export async function autoHandleSpecials(page, pageState, profile) {
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
