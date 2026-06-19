import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openSession, sendMessage } from './chatgpt_headless.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const profilePath = path.join(__dirname, '..', 'data', 'profile.json');

// ─── Load Candidate Profile ──────────────────────────────────────────────────
function loadProfile() {
  if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

// ─── Scrape Full Page State (deep scan) ─────────────────────────────────────
async function scrapePageState(page) {
  return await page.evaluate(() => {
    function getSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.name) return `[name="${CSS.escape(el.name)}"]`;
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body && parts.length < 4) {
        let tag = cur.tagName.toLowerCase();
        const siblings = Array.from(cur.parentElement?.children || []).filter(c => c.tagName === cur.tagName);
        if (siblings.length > 1) tag += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        parts.unshift(tag);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    function getLabel(el) {
      // 1. Linked <label for="id">
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim();
      }
      // 2. Wrapping <label>
      const parentLbl = el.closest('label');
      if (parentLbl) return parentLbl.innerText.replace(el.value || '', '').trim();
      // 3. aria-label / placeholder / name
      const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name');
      if (aria) return aria;
      // 4. Walk UP: check previous sibling and parent text nodes (covers React patterns)
      let cur = el.parentElement;
      for (let i = 0; i < 4 && cur; i++) {
        // Look at previous sibling elements for label-like text
        let sib = cur.previousElementSibling;
        if (sib && sib.innerText && sib.innerText.trim().length < 100) return sib.innerText.trim();
        // Look at first text-only child of parent (common pattern: <div>Label <select>)
        for (const child of cur.childNodes) {
          if (child.nodeType === 3 /* TEXT_NODE */ && child.textContent.trim()) {
            return child.textContent.trim();
          }
        }
        cur = cur.parentElement;
      }
      return '';
    }

    // ── Form fields ──────────────────────────────────────────────────────────
    const fields = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const rawType = el.tagName.toLowerCase() === 'select' ? 'select'
        : (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(rawType)) return;

      const label = getLabel(el);

      // IMPORTANT: NEVER skip <select> elements — they are dropdowns and must always be included
      // For other inputs: skip only if truly unlabeled and has no name/id
      if (rawType !== 'select' && !label && !el.name && !el.id) return;

      const field = {
        label: label.replace(/\s+/g, ' ').trim(),
        type: rawType,           // text | textarea | select | checkbox | radio | file | email | number | tel | url
        selector: getSelector(el),
        required: el.required || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled,
        currentValue: el.value || '',
        placeholder: el.getAttribute('placeholder') || '',
      };

      if (rawType === 'select') {
        // Include ALL options with exact text and value — GPT needs exact text to match
        field.options = Array.from(el.options).map(o => ({
          text: o.text.trim(),
          value: o.value,
          isPlaceholder: o.disabled || o.value === '' || o.value === 'default'
        }));
      }
      if (rawType === 'radio' || rawType === 'checkbox') {
        field.checked = el.checked;
        if (el.name) {
          const group = document.querySelectorAll(`input[name="${el.name}"]`);
          if (group.length > 1) field.groupOptions = Array.from(group).map(r => ({ value: r.value, checked: r.checked }));
        }
      }

      fields.push(field);
    });

    // ── SAFETY NET: Force-include every <select> not already in fields ────────
    // This guarantees dropdowns are NEVER silently dropped, even without labels.
    const alreadyTracked = new Set(fields.filter(f => f.type === 'select').map(f => f.selector));
    document.querySelectorAll('select').forEach(el => {
      const sel = getSelector(el);
      if (alreadyTracked.has(sel)) return; // already captured

      // Try to find a label from the page context
      const containerText = el.closest('div, p, td, li')?.innerText?.trim() || '';
      const labelGuess = containerText.replace(el.options[el.selectedIndex]?.text || '', '').trim().slice(0, 80);

      fields.push({
        label: labelGuess || `Dropdown (${sel})`,
        type: 'select',
        selector: sel,
        required: el.required,
        disabled: el.disabled,
        currentValue: el.value || '',
        options: Array.from(el.options).map(o => ({
          text: o.text.trim(),
          value: o.value,
          isPlaceholder: o.disabled || o.value === '' || o.value === 'default'
        })),
      });
    });

    // ── Canvas elements (signature pads) ─────────────────────────────────────
    const canvases = [];
    document.querySelectorAll('canvas').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 30) {
        const nearbyLabel = el.closest('div')?.previousElementSibling?.innerText?.trim()
          || el.getAttribute('aria-label') || 'Signature Canvas';
        canvases.push({
          type: 'canvas',
          label: nearbyLabel,
          selector: getSelector(el),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });

    // ── Custom dropdowns (React/div-based, not native <select>) ────────────────
    const customDropdowns = [];
    const customSelectors = [
      '[role="combobox"]',
      '[role="listbox"]',
      '[aria-haspopup="listbox"]',
      '[aria-haspopup="true"]',
      '[class*="dropdown"]',
      '[class*="select"]',
    ];
    const seen = new Set();
    customSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const key = getSelector(el);
        if (seen.has(key)) return;
        seen.add(key);
        // skip if it is a native select or button
        if (el.tagName === 'SELECT' || el.tagName === 'BUTTON') return;
        const label = el.getAttribute('aria-label')
          || el.closest('label')?.innerText?.trim()
          || el.previousElementSibling?.innerText?.trim()
          || el.getAttribute('placeholder')
          || 'Custom Dropdown';
        const currentText = el.innerText?.trim() || el.getAttribute('value') || '';
        customDropdowns.push({
          label,
          type: 'custom-dropdown',
          selector: key,
          currentText,
          role: el.getAttribute('role') || 'custom',
        });
      });
    });

    // ── Buttons ──────────────────────────────────────────────────────────────
    const buttons = [];
    document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(el => {
      const text = (el.innerText || el.value || '').trim();
      if (!text) return;
      buttons.push({
        text,
        selector: getSelector(el),
        type: el.getAttribute('type') || 'button',
        disabled: el.disabled,
      });
    });

    return {
      url: window.location.href,
      title: document.title,
      pageText: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 3000),
      fields,
      canvases,
      customDropdowns: customDropdowns.slice(0, 15),
      buttons: buttons.slice(0, 25),
    };
  });
}

// ─── Sanitize GPT JSON (remove literal control characters inside strings) ────
// GPT sometimes emits literal \n inside string values which breaks JSON.parse.
// This tracks whether we are inside a JSON string and escapes control chars only there.
function sanitizeGptJson(raw) {
  // First: extract the outermost { ... } block
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in GPT response');
  let src = raw.slice(start, end + 1);

  let result = '';
  let inString = false;
  let escaped  = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (escaped) {
      result  += ch;
      escaped  = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result  += ch;
      escaped  = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result  += ch;
      continue;
    }

    // Inside a JSON string, control characters must be escaped
    if (inString) {
      if      (ch === '\n') { result += '\\n';  continue; }
      else if (ch === '\r') { result += '\\r';  continue; }
      else if (ch === '\t') { result += '\\t';  continue; }
      else if (ch.charCodeAt(0) < 0x20) continue; // drop other control chars
    }

    result += ch;
  }

  return JSON.parse(result);
}

// ─── Build Agent Prompt ──────────────────────────────────────────────────────
function buildAgentPrompt(profile, pageState, stepNum) {
  return `
You are an AI job application agent. Analyze the current page and decide the next actions.
Return ONLY a raw JSON object. No markdown, no explanation, no code fences.

---
CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

---
CURRENT PAGE (Step ${stepNum}):
URL: ${pageState.url}
Title: ${pageState.title}
Page Text (excerpt): ${pageState.pageText}

FORM FIELDS (${pageState.fields.length}):
${JSON.stringify(pageState.fields, null, 2)}

NATIVE SELECT DROPDOWNS are already in FORM FIELDS above — use "select" action type for them.
For each select field, options[] lists ALL choices with exact .text and .value.
Always use the EXACT .text string from the options[] list as the "value" in your select action.

CUSTOM DROPDOWNS (${pageState.customDropdowns?.length || 0}) — click to open then click option:
${JSON.stringify(pageState.customDropdowns, null, 2)}

CANVAS ELEMENTS (${pageState.canvases.length}) - signature pads:
${JSON.stringify(pageState.canvases, null, 2)}

BUTTONS (${pageState.buttons.length}):
${JSON.stringify(pageState.buttons, null, 2)}

---
RETURN FORMAT (strict JSON):
{
  "reasoning": "what you see and plan to do",
  "actions": [
    ACTION_OBJECTS...
  ],
  "status": "continue" | "done" | "error",
  "message": "summary of what you did"
}

ACTION TYPES and their fields:
1. Fill text/textarea/email/number/url/tel input:
   { "type": "fill", "selector": "#id", "value": "text to type", "description": "field name" }

2. Select dropdown option:
   { "type": "select", "selector": "#id", "value": "exact option text", "description": "field name" }

3. Click a button or element:
   { "type": "click", "selector": "button", "description": "button label" }

4. Check a checkbox (agree / accept terms etc.):
   { "type": "check", "selector": "#checkbox-id", "description": "checkbox label" }

5. Upload a file (resume):
   { "type": "upload", "selector": "input[type=file]", "description": "Resume upload" }
   (the system will automatically use the resumePdfPath from profile)

6. Draw signature on canvas:
   { "type": "signature", "selector": "canvas", "description": "Candidate Signature" }

RULES:
- Fill ALL text fields on the current page before clicking any button.
- For NATIVE SELECT dropdowns: You MUST use the exact ".text" string from the options[] array as the "value" in your select action. Never guess — pick from the list.
- For YES/NO or location dropdowns: match candidate profile (city: Surat → NOT Ahmedabad → pick "No" for "Are you from Ahmedabad?").
- For CUSTOM DROPDOWNS (type: custom-dropdown): use a "select" action with the selector of the custom dropdown and value = the exact option text you want.
- For checkboxes like "I accept terms": always check them.
- For signature canvas: always include a signature action.
- For file upload input: use the upload action (do NOT skip it).
- After filling all fields on this page, click "Next Page" or "Submit Application" as the last action.
- If you already see a "Thank you" or success confirmation, set status to "done".
- NEVER click "Back" buttons.
- If a field already has a non-empty currentValue that matches the expected value, skip it.
`.trim();
}

// ─── Draw Signature on Canvas ────────────────────────────────────────────────
async function drawSignature(page, selector, name) {
  console.log(`    ✍ Drawing signature for "${name}"...`);
  try {
    const canvas = page.locator(selector).first();
    if (!await canvas.count()) {
      // Fallback: try first canvas
      const anyCanvas = page.locator('canvas').first();
      if (!await anyCanvas.count()) return;
    }

    const box = await (await canvas.count() ? canvas : page.locator('canvas').first()).boundingBox();
    if (!box) return;

    // Draw a cursive-style signature using mouse movements
    const cx = box.x + box.width * 0.15;
    const cy = box.y + box.height * 0.55;
    const w  = box.width * 0.7;
    const h  = box.height * 0.35;

    await page.mouse.move(cx, cy);
    await page.mouse.down();

    // Cursive signature path — wavy strokes
    const points = [
      [0.00, 0.0], [0.05, -0.8], [0.10, -1.0], [0.15, -0.8], [0.18, 0.0],
      [0.22, 0.3], [0.27, -0.6], [0.32, -0.9], [0.37, -0.6], [0.40, 0.0],
      [0.45, 0.4], [0.50, -0.5], [0.55, -0.8], [0.60, -0.5], [0.63, 0.0],
      [0.68, 0.3], [0.73, -0.4], [0.78, -0.7], [0.83, -0.4], [0.88, 0.0],
      [0.93, 0.2], [0.97, 0.1], [1.00, 0.0],
    ];

    for (const [px, py] of points) {
      await page.mouse.move(cx + px * w, cy + py * h, { steps: 3 });
    }

    // Underline stroke
    await page.mouse.move(cx, cy + h * 0.5);
    await page.mouse.move(cx + w, cy + h * 0.5, { steps: 20 });

    await page.mouse.up();
    await page.waitForTimeout(300);
    console.log(`    ✓ Signature drawn`);
  } catch (e) {
    console.log(`    ⚠ Signature failed: ${e.message.split('\n')[0]}`);
  }
}

// ─── Execute a Single Action ─────────────────────────────────────────────────
async function executeAction(page, action, profile) {
  const label = action.description || action.selector;
  console.log(`  [${action.type.toUpperCase()}] ${label}`);

  try {
    switch (action.type) {

      case 'fill': {
        const el = page.locator(action.selector).first();
        if (!await el.count()) { console.log(`    ⚠ Not found`); break; }
        if (await el.isDisabled()) { console.log(`    ⚠ Disabled, skipping`); break; }
        await el.click({ timeout: 3000 }).catch(() => {});
        await el.fill(String(action.value || ''), { timeout: 5000 });
        console.log(`    → "${String(action.value || '').slice(0, 70)}"`);
        break;
      }

      case 'select': {
        const el = page.locator(action.selector).first();
        if (!await el.count()) { console.log(`    ⚠ Not found`); break; }

        const tagName = await el.evaluate(e => e.tagName.toLowerCase());

        if (tagName === 'select') {
          // ── Native <select> ──────────────────────────────────────────────
          // Get all real options for fuzzy match
          const allOpts = await el.evaluate(s =>
            Array.from(s.options).map(o => ({ text: o.text.trim(), value: o.value }))
          );
          const target = String(action.value).toLowerCase().trim();

          // 1. Exact text match
          let match = allOpts.find(o => o.text.toLowerCase() === target);
          // 2. Partial text match
          if (!match) match = allOpts.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
          // 3. Value match
          if (!match) match = allOpts.find(o => o.value.toLowerCase() === target);

          if (match) {
            await el.selectOption({ value: match.value });
            console.log(`    → selected "${match.text}" (value: ${match.value})`);
          } else {
            // Last resort: selectOption by label
            await el.selectOption({ label: action.value }).catch(() =>
              el.selectOption(action.value).catch(() => {})
            );
            console.log(`    → attempted select "${action.value}"`);
          }
        } else {
          // ── Custom div-based dropdown ────────────────────────────────────
          // Click to open the dropdown
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(500);

          // Try to find and click the option by text
          const target = String(action.value);
          const optionSelectors = [
            `[role="option"]:has-text("${target}")`,
            `li:has-text("${target}")`,
            `[class*="option"]:has-text("${target}")`,
            `div:has-text("${target}")`,
          ];

          let clicked = false;
          for (const sel of optionSelectors) {
            const opt = page.locator(sel).first();
            if (await opt.count()) {
              await opt.click({ timeout: 2000 });
              clicked = true;
              break;
            }
          }
          if (!clicked) {
            // Fuzzy: find any visible element containing the text
            await page.getByText(target, { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
          }
          console.log(`    → custom dropdown selected "${target}"`);
          await page.waitForTimeout(300);
        }
        break;
      }

      case 'click': {
        let el = page.locator(action.selector).first();
        if (!await el.count()) {
          // Fallback: search by button text
          el = page.getByRole('button', { name: action.description || '' });
        }
        if (!await el.count()) { console.log(`    ⚠ Not found`); break; }
        await el.scrollIntoViewIfNeeded();
        await el.click({ timeout: 5000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1200);
        break;
      }

      case 'check': {
        const el = page.locator(action.selector).first();
        if (!await el.count()) { console.log(`    ⚠ Not found`); break; }
        if (!await el.isChecked()) await el.check({ timeout: 3000 });
        console.log(`    → Checked ✓`);
        break;
      }

      case 'uncheck': {
        const el = page.locator(action.selector).first();
        if (!await el.count()) break;
        if (await el.isChecked()) await el.uncheck({ timeout: 3000 });
        break;
      }

      case 'upload': {
        // Try the specified selector, then any file input on the page
        let el = page.locator(action.selector).first();
        if (!await el.count()) el = page.locator('input[type="file"]').first();
        if (!await el.count()) { console.log(`    ⚠ No file input found`); break; }

        const pdfPath = profile.resumePdfPath;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          console.log(`    ⚠ Resume PDF not found at: ${pdfPath}`);
          console.log(`    → Update "resumePdfPath" in profile.json`);
          break;
        }
        await el.setInputFiles(pdfPath);
        console.log(`    → Uploaded: ${path.basename(pdfPath)}`);
        break;
      }

      case 'signature': {
        await drawSignature(page, action.selector, label);
        break;
      }

      default:
        console.log(`    ⚠ Unknown action type: ${action.type}`);
    }

    await page.waitForTimeout(250);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message.split('\n')[0]}`);
  }
}

// ─── Post-action: Auto-detect and handle canvas if GPT missed it ─────────────
async function autoHandleSpecials(page, pageState, profile) {
  // Auto-detect file inputs that weren't filled yet
  for (const field of pageState.fields) {
    if (field.type === 'file' && !field.currentValue) {
      console.log(`  [AUTO] Uploading resume to file input: ${field.label}`);
      await executeAction(page, { type: 'upload', selector: field.selector, description: field.label }, profile);
    }
  }
  // Auto-detect unchecked checkboxes that look like "agree" or "accept"
  for (const field of pageState.fields) {
    if (field.type === 'checkbox' && !field.checked) {
      const lbl = field.label.toLowerCase();
      if (lbl.includes('agree') || lbl.includes('accept') || lbl.includes('terms') || lbl.includes('conditions')) {
        console.log(`  [AUTO] Checking terms checkbox: ${field.label}`);
        await executeAction(page, { type: 'check', selector: field.selector, description: field.label }, profile);
      }
    }
  }
  // Auto-detect signature canvas
  for (const canvas of pageState.canvases) {
    console.log(`  [AUTO] Drawing signature on canvas: ${canvas.label}`);
    await drawSignature(page, canvas.selector, canvas.label);
  }
}

// ─── Main Agentic Loop ───────────────────────────────────────────────────────
export async function applyToJob(jobUrl, options = {}) {
  const { visible = false } = options;
  const profile = loadProfile();

  console.log('\n============================================================');
  console.log('  Job Application AI Agent');
  console.log('============================================================');
  console.log(`URL     : ${jobUrl}`);
  console.log(`Applying: ${profile.name} <${profile.email}>`);
  console.log(`Resume  : ${profile.resumePdfPath || 'No PDF set'}`);
  console.log('============================================================\n');

  // Open ChatGPT session
  console.log('[Init] Connecting to ChatGPT session...');
  const { browser: gptBrowser, page: gptPage } = await openSession(false);

  // Open job application browser
  console.log('[Init] Opening job application page...');
  const appBrowser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      ...(visible ? [] : ['--start-minimized'])
    ]
  });
  const appContext = await appBrowser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const appPage = await appContext.newPage();

  try {
    await appPage.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await appPage.waitForTimeout(3000);

    const maxSteps = 20;
    let step = 1;

    while (step <= maxSteps) {
      console.log(`\n══════════════════════════════════════════════════`);
      console.log(`  STEP ${step} — ${new Date().toLocaleTimeString()}`);
      console.log(`══════════════════════════════════════════════════`);

      const pageState = await scrapePageState(appPage);
      console.log(`  URL     : ${pageState.url}`);
      console.log(`  Fields  : ${pageState.fields.length} | Buttons: ${pageState.buttons.length} | Canvases: ${pageState.canvases.length}`);

      // Save step screenshot
      await appPage.screenshot({ path: path.join(process.cwd(), `step_${step}.png`) }).catch(() => {});

      // Ask GPT
      console.log(`\n  🤖 Asking ChatGPT for actions...`);
      const prompt = buildAgentPrompt(profile, pageState, step);
      const raw = await sendMessage(gptPage, prompt);

      // Parse response — sanitize control chars before parsing
      let agentResp;
      let parseAttempt = raw;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          agentResp = sanitizeGptJson(parseAttempt);
          break; // success
        } catch (e) {
          if (attempt === 1) {
            // Ask GPT to re-send only the JSON
            console.log(`  ⚠ JSON parse error (attempt ${attempt}): ${e.message}`);
            console.log(`  🔄 Asking GPT to re-send clean JSON...`);
            parseAttempt = await sendMessage(gptPage,
              'Your last response contained invalid characters that broke JSON parsing. ' +
              'Please re-send ONLY the raw JSON object from your last response, with no explanation, no markdown, no code fences.'
            );
          } else {
            console.log(`  ✗ JSON parse failed after retry: ${e.message}`);
            console.log(`  Raw (first 400 chars): ${parseAttempt.slice(0, 400)}`);
            agentResp = null;
          }
        }
      }

      if (!agentResp) {
        console.log(`  Skipping this step and trying to continue...`);
        step++;
        continue;
      }


      console.log(`\n  💭 ${agentResp.reasoning}`);
      console.log(`  📋 ${agentResp.actions?.length || 0} actions | Status: ${agentResp.status}`);

      // Handle done/error
      if (agentResp.status === 'done') {
        console.log('\n\n✅ Application submitted successfully!');
        await appPage.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true }).catch(() => {});
        console.log('   Screenshot saved: application_done.png');
        break;
      }
      if (agentResp.status === 'error') {
        console.log(`\n❌ Agent error: ${agentResp.message}`);
        break;
      }

      // Execute GPT actions
      if (agentResp.actions?.length) {
        console.log(`\n  Executing actions:`);
        for (const action of agentResp.actions) {
          await executeAction(appPage, action, profile);
        }
      } else {
        console.log('  ⚠ No actions from GPT — checking for specials...');
      }

      // Auto-handle anything GPT may have missed (file, checkbox, canvas)
      const freshState = await scrapePageState(appPage);
      await autoHandleSpecials(appPage, freshState, profile);

      step++;
    }

    if (step > maxSteps) console.log(`\n⚠️  Reached max steps (${maxSteps}).`);

  } finally {
    await gptBrowser.close();
    await appBrowser.close();
    console.log('\n[Done] Browsers closed.\n');
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const jobUrl = process.argv[2];
  const visible = process.argv.includes('--visible');

  if (!jobUrl) {
    console.log('\nUsage:');
    console.log('  node job_applier.js "https://company.com/apply/123"');
    console.log('  node job_applier.js "https://company.com/apply/123" --visible\n');
    process.exit(0);
  }

  applyToJob(jobUrl, { visible })
    .then(() => process.exit(0))
    .catch(e => { console.error('\n[Fatal]', e.message); process.exit(1); });
}
