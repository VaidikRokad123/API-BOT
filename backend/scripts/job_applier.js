import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openSession, sendMessage } from './chatgpt_headless.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const profilePath = path.join(__dirname, '..', 'data', 'profile.json');

// ─── Load Candidate Profile ─────────────────────────────────────────────────
function loadProfile() {
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}\nCreate backend/data/profile.json first.`);
  }
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

// ─── Scrape Full Page State ──────────────────────────────────────────────────
// Returns a structured snapshot of everything visible and interactive on screen
async function scrapePageState(page) {
  return await page.evaluate(() => {
    // ── Helper: Get a short unique CSS selector for an element ──
    function getSelector(el) {
      if (el.id) return `#${el.id}`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.name) return `[name="${el.name}"]`;

      // Build a path using tag + nth-child
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body) {
        let tag = cur.tagName.toLowerCase();
        const siblings = Array.from(cur.parentElement?.children || []).filter(c => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          tag += `:nth-of-type(${idx})`;
        }
        parts.unshift(tag);
        cur = cur.parentElement;
        if (parts.length >= 4) break;
      }
      return parts.join(' > ');
    }

    // ── Helper: Find label for a form element ──
    function getLabel(el) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim();
      }
      const parentLbl = el.closest('label');
      if (parentLbl) return parentLbl.innerText.replace(el.value || '', '').trim();
      const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (ariaLabel) {
        const ref = document.getElementById(ariaLabel);
        return ref ? ref.innerText.trim() : ariaLabel;
      }
      return el.getAttribute('placeholder') || el.getAttribute('name') || '';
    }

    // ── Collect all form fields ──
    const fields = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const type = el.tagName.toLowerCase() === 'select' ? 'select'
        : (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;

      const label = getLabel(el);
      if (!label && !el.name && !el.id) return;

      const field = {
        label,
        type,
        selector: getSelector(el),
        required: el.required || el.getAttribute('aria-required') === 'true',
        currentValue: el.value || '',
        disabled: el.disabled,
      };

      if (type === 'select') {
        field.options = Array.from(el.options).map(o => ({ text: o.text, value: o.value })).filter(o => o.text.trim());
      }
      if (type === 'radio' || type === 'checkbox') {
        field.checked = el.checked;
        const nameGroup = el.name ? document.querySelectorAll(`input[name="${el.name}"]`) : [];
        if (nameGroup.length > 1) {
          field.groupOptions = Array.from(nameGroup).map(r => r.value);
        }
      }

      fields.push(field);
    });

    // ── Collect all clickable buttons ──
    const buttons = [];
    document.querySelectorAll('button, input[type="submit"], a[role="button"], [class*="btn"]').forEach(el => {
      const text = el.innerText?.trim() || el.value || el.getAttribute('aria-label') || '';
      if (!text) return;
      buttons.push({
        text,
        selector: getSelector(el),
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        disabled: el.disabled,
      });
    });

    // ── Collect visible links (for navigation) ──
    const links = [];
    document.querySelectorAll('a[href]').forEach(el => {
      const text = el.innerText?.trim();
      if (text && el.href && !el.href.startsWith('javascript')) {
        links.push({ text, href: el.href });
      }
    });

    // ── Page text (capped for GPT context) ──
    const bodyText = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 2500);

    return {
      url: window.location.href,
      title: document.title,
      fields,
      buttons: buttons.slice(0, 20),
      links: links.slice(0, 10),
      bodyText,
    };
  });
}

// ─── Build GPT Prompt ────────────────────────────────────────────────────────
function buildAgentPrompt(profile, pageState, stepNum) {
  return `
You are an intelligent job application agent. You are on step ${stepNum} of filling out a job application form.
You will analyze the current web page and decide what actions to perform.

Return ONLY a raw JSON object — no markdown, no explanation, no code fences.

---
CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

---
CURRENT PAGE STATE:
URL: ${pageState.url}
Title: ${pageState.title}
Page Content: ${pageState.bodyText}

INTERACTIVE FORM FIELDS (${pageState.fields.length} found):
${JSON.stringify(pageState.fields, null, 2)}

CLICKABLE BUTTONS (${pageState.buttons.length} found):
${JSON.stringify(pageState.buttons, null, 2)}

---
INSTRUCTIONS:
1. Analyze the page content and form fields.
2. Use the candidate profile to fill each field with the best matching value.
3. Return a JSON object in EXACTLY this format:

{
  "reasoning": "Brief explanation of what you see and what you plan to do",
  "actions": [
    {
      "type": "fill",
      "selector": "#fieldId",
      "value": "the value to type",
      "description": "human-readable label"
    },
    {
      "type": "click",
      "selector": "button[type=submit]",
      "description": "Submit button"
    },
    {
      "type": "select",
      "selector": "#dropdown",
      "value": "option value or text",
      "description": "Dropdown label"
    }
  ],
  "status": "continue",
  "message": "What you did and what comes next"
}

Status values:
- "continue"  → more steps needed after these actions (e.g. clicked Next)
- "done"      → application is fully submitted
- "error"     → something is wrong, cannot proceed

IMPORTANT RULES:
- Only fill fields that are currently VISIBLE and NOT disabled.
- If a field already has a value, skip it.
- For file upload inputs (type=file), SKIP them (we don't support file uploads).
- Always include ALL fill/select actions for fields on the current page before clicking any navigation button.
- Fill fields before clicking Next/Submit.
- If you see a Submit or Apply button, click it as the last action.
- If the page says "Thank you" or "Application submitted" or similar, set status to "done".
`.trim();
}

// ─── Execute Actions from GPT ────────────────────────────────────────────────
async function executeActions(page, actions) {
  for (const action of actions) {
    try {
      console.log(`  [${action.type.toUpperCase()}] ${action.description || action.selector}`);

      if (action.type === 'fill') {
        const el = page.locator(action.selector).first();
        if (await el.count() === 0) { console.log(`    ⚠ Not found: ${action.selector}`); continue; }
        await el.click({ timeout: 3000 }).catch(() => {});
        await el.fill(action.value || '', { timeout: 3000 });

      } else if (action.type === 'select') {
        const el = page.locator(action.selector).first();
        if (await el.count() === 0) { console.log(`    ⚠ Not found: ${action.selector}`); continue; }
        await el.selectOption({ label: action.value }).catch(() =>
          el.selectOption({ value: action.value }).catch(() =>
            el.selectOption(action.value)
          )
        );

      } else if (action.type === 'click') {
        const el = page.locator(action.selector).first();
        if (await el.count() === 0) {
          // Try text-based click fallback
          const byText = page.getByRole('button', { name: action.description });
          if (await byText.count()) {
            await byText.click({ timeout: 5000 });
          } else {
            console.log(`    ⚠ Not found: ${action.selector}`);
          }
          continue;
        }
        await el.click({ timeout: 5000 });
        // Wait for any navigation or DOM change after click
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1000);

      } else if (action.type === 'check') {
        const el = page.locator(action.selector).first();
        if (await el.count()) await el.check();

      } else if (action.type === 'uncheck') {
        const el = page.locator(action.selector).first();
        if (await el.count()) await el.uncheck();
      }

      await page.waitForTimeout(300); // small pause between actions

    } catch (e) {
      console.log(`    ✗ Error on "${action.description}": ${e.message.split('\n')[0]}`);
    }
  }
}

// ─── Main Agentic Loop ───────────────────────────────────────────────────────
export async function applyToJob(jobUrl, options = {}) {
  const { visible = false } = options;
  const profile = loadProfile();

  console.log('\n============================================================');
  console.log('  Job Application AI Agent');
  console.log('============================================================');
  console.log(`URL: ${jobUrl}`);
  console.log(`Candidate: ${profile.name} <${profile.email}>`);
  console.log('============================================================\n');

  // ── Open ChatGPT session ──
  console.log('[Init] Connecting to ChatGPT session...');
  const { browser: gptBrowser, page: gptPage } = await openSession(false);

  // ── Open a separate browser for the job application page ──
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
    viewport: { width: 1280, height: 900 }
  });
  const appPage = await appContext.newPage();

  try {
    await appPage.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await appPage.waitForTimeout(2500); // Let React / JS hydrate

    const maxSteps = 15;
    let step = 1;
    let done = false;

    while (!done && step <= maxSteps) {
      console.log(`\n──────────────────────────────────────────────────`);
      console.log(`[Step ${step}/${maxSteps}] Scraping page state...`);

      // Scrape current page state
      const pageState = await scrapePageState(appPage);
      console.log(`  URL: ${pageState.url}`);
      console.log(`  Fields: ${pageState.fields.length} | Buttons: ${pageState.buttons.length}`);

      // Save screenshot of this step
      await appPage.screenshot({
        path: path.join(process.cwd(), `step_${step}.png`),
        fullPage: false
      });

      // Ask GPT what to do
      console.log(`[Step ${step}/${maxSteps}] Asking ChatGPT for next actions...`);
      const prompt = buildAgentPrompt(profile, pageState, step);
      const rawResponse = await sendMessage(gptPage, prompt);

      // Parse GPT JSON response
      let agentResponse;
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');
        agentResponse = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.log(`  ✗ GPT returned invalid JSON: ${e.message}`);
        console.log(`  Raw: ${rawResponse.slice(0, 300)}`);
        break;
      }

      console.log(`\n  💭 GPT Reasoning: ${agentResponse.reasoning}`);
      console.log(`  📋 Actions: ${agentResponse.actions?.length || 0}`);
      console.log(`  📌 Status: ${agentResponse.status}`);
      console.log(`  💬 Message: ${agentResponse.message}`);

      // Check terminal status
      if (agentResponse.status === 'done') {
        console.log('\n\n✅ Application submitted successfully!');
        await appPage.screenshot({ path: path.join(process.cwd(), 'application_done.png'), fullPage: true });
        done = true;
        break;
      }

      if (agentResponse.status === 'error') {
        console.log(`\n\n❌ Agent stopped: ${agentResponse.message}`);
        break;
      }

      // Execute all actions GPT decided
      if (agentResponse.actions?.length) {
        console.log(`\n  Executing ${agentResponse.actions.length} actions:`);
        await executeActions(appPage, agentResponse.actions);
      } else {
        console.log('  ⚠ No actions returned by GPT. Stopping to avoid infinite loop.');
        break;
      }

      step++;
    }

    if (step > maxSteps) {
      console.log(`\n⚠️  Reached max steps (${maxSteps}). Stopping.`);
    }

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
    .catch(e => {
      console.error('\n[Fatal Error]', e.message);
      process.exit(1);
    });
}
