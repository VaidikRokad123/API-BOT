import fs from 'fs';
import path from 'path';

export async function drawSignature(page, selector) {
  try {
    let canvas = page.locator(selector).first();
    if (!await canvas.count()) canvas = page.locator('canvas').first();
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
        const el = page.locator(action.selector).first();
        if (!await el.count()) { console.log('    ⚠ Not found'); break; }
        if (await el.isDisabled()) { console.log('    ⚠ Disabled'); break; }
        await el.click({ timeout: 3000 }).catch(() => {});
        await el.fill(String(action.value || ''), { timeout: 5000 });
        console.log(`    → "${String(action.value || '').slice(0, 80)}"`);
        break;
      }

      case 'select': {
        const el = page.locator(action.selector).first();
        if (!await el.count()) { console.log('    ⚠ Not found'); break; }
        const tag = await el.evaluate(e => e.tagName.toLowerCase());

        if (tag === 'select') {
          const allOpts = await el.evaluate(s => Array.from(s.options).map(o => ({ text: o.text.trim(), value: o.value })));
          const target  = String(action.value).toLowerCase().trim();
          let match = allOpts.find(o => o.text.toLowerCase() === target)
                   || allOpts.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()))
                   || allOpts.find(o => o.value.toLowerCase() === target);
          if (match) {
            await el.selectOption({ value: match.value });
            console.log(`    → selected "${match.text}"`);
          } else {
            await el.selectOption({ label: action.value }).catch(() => el.selectOption(action.value).catch(() => {}));
            console.log(`    → attempted "${action.value}"`);
          }
        } else {
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(500);
          const target = String(action.value);
          let clicked = false;
          for (const sel of [`[role="option"]:has-text("${target}")`, `li:has-text("${target}")`, `[class*="option"]:has-text("${target}")`]) {
            const opt = page.locator(sel).first();
            if (await opt.count()) { await opt.click({ timeout: 2000 }); clicked = true; break; }
          }
          if (!clicked) await page.getByText(target, { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
          console.log(`    → custom dropdown "${target}"`);
        }
        break;
      }

      case 'click': {
        let el = page.locator(action.selector).first();
        if (!await el.count()) el = page.getByRole('button', { name: action.description || '' });
        if (!await el.count()) { console.log('    ⚠ Not found'); break; }
        await el.scrollIntoViewIfNeeded();
        await el.click({ timeout: 5000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1200);
        break;
      }

      case 'check': {
        const el = page.locator(action.selector).first();
        if (!await el.count()) { console.log('    ⚠ Not found'); break; }
        if (!await el.isChecked()) await el.check({ timeout: 3000 });
        console.log('    → Checked ✓');
        break;
      }

      case 'upload': {
        let el = page.locator(action.selector).first();
        if (!await el.count()) el = page.locator('input[type="file"]').first();
        if (!await el.count()) { console.log('    ⚠ No file input'); break; }
        const pdfPath = profile.resumePdfPath;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          console.log(`    ⚠ Resume PDF not found: ${pdfPath}`);
          console.log('    → Set "resumePdfPath" in data/profile.json');
          break;
        }
        await el.setInputFiles(pdfPath);
        console.log(`    → Uploaded: ${path.basename(pdfPath)}`);
        break;
      }

      case 'signature': {
        await drawSignature(page, action.selector);
        break;
      }

      default: console.log(`    ⚠ Unknown action: ${action.type}`);
    }

    await page.waitForTimeout(250);
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
