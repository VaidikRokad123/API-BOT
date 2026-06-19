import fs from 'fs';
import readline from 'readline';
import { chromium } from 'playwright';
import { STEALTH_ARGS, newStealthContext } from './browser.js';
import { ACTIVE_FILE, sessionFile } from './config.js';
import { getProvider } from './providers/index.js';

export const MENU = [
  { key: 'chatgpt',    label: 'ChatGPT',    host: 'chatgpt.com'       },
  { key: 'grok',       label: 'Grok',       host: 'grok.com'          },
  { key: 'gemini',     label: 'Gemini',     host: 'gemini.google.com' },
  { key: 'perplexity', label: 'Perplexity', host: 'perplexity.ai'     },
  { key: 'deepseek',   label: 'DeepSeek',   host: 'chat.deepseek.com' },
];

const question = (rl, q) => new Promise((resolve) => rl.question(q, resolve));

// externalRl — the REPL's readline. We MUST reuse it; creating a second
// interface on the same stdin garbles input. When null (standalone), we own one.
export async function login(externalRl = null, providerKey = null) {
  const rl    = externalRl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ownRl = !externalRl;

  let item;
  if (providerKey) {
    item = MENU.find(p => p.key === providerKey);
  }

  if (!item) {
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║          Choose Your AI Provider             ║');
    console.log('  ╚══════════════════════════════════════════════╝\n');
    MENU.forEach((p, i) => console.log(`    ${i + 1})  ${p.label.padEnd(12)}  ${p.host}`));
    console.log();

    const answer = (await question(rl, `  Enter 1–${MENU.length} (or blank to cancel): `)).trim();

    // Graceful aborts — never kill the REPL on a typo.
    if (!answer) { console.log('\n  Cancelled.\n'); if (ownRl) rl.close(); return; }
    item = MENU[parseInt(answer, 10) - 1];
  }

  if (!item) { console.log('\n  Invalid choice — returning to menu.\n'); if (ownRl) rl.close(); return; }

  providerKey = item.key;
  const provider    = getProvider(providerKey);

  console.log(`\n  A browser window will open → sign in to ${provider.config.name}.`);

  let browser;
  try {
    browser    = await chromium.launch({ headless: false, args: STEALTH_ARGS });
    const ctx  = await newStealthContext(browser);
    const page = await ctx.newPage();
    await page.goto(provider.config.url);

    await question(rl, '  Once logged in, press ENTER here to save the session... ');

    // Wait for background iframes (auth, payment scripts) to settle before saving.
    // storageState() fails if a frame is mid-navigation when it's called.
    console.log('  Saving session...');
    await page.waitForTimeout(3000);

    const sFile = sessionFile(providerKey);
    try {
      await ctx.storageState({ path: sFile });
    } catch {
      await page.waitForTimeout(3000);
      await ctx.storageState({ path: sFile });
    }

    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: providerKey }, null, 2));

    console.log(`\n  ✅ Logged in as ${provider.config.name}`);
    console.log(`     Session saved: ${sFile}`);
    console.log('     You can now use /chat and /apply.\n');
  } catch (e) {
    console.error('\n  ✗ Login failed:', e.message, '\n');
  } finally {
    if (browser) await browser.close();
    if (ownRl) rl.close();
  }
}

export async function selectModel(externalRl = null, modelArg = '') {
  const rl    = externalRl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ownRl = !externalRl;

  let item;
  const arg = modelArg.trim().toLowerCase();

  if (arg) {
    // Try to match by index first
    const idx = parseInt(arg, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= MENU.length) {
      item = MENU[idx - 1];
    } else {
      // Match by key or label
      item = MENU.find(p => p.key === arg || p.label.toLowerCase() === arg);
    }

    if (!item) {
      console.log(`\n  Invalid model name or index "${modelArg}".`);
      console.log(`  Valid models: ${MENU.map(p => p.key).join(', ')}\n`);
      if (ownRl) rl.close();
      return;
    }
  } else {
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║              Select AI Model                 ║');
    console.log('  ╚══════════════════════════════════════════════╝\n');
    MENU.forEach((p, i) => console.log(`    ${i + 1})  ${p.label.padEnd(12)}  ${p.host}`));
    console.log();

    const answer = (await question(rl, `  Enter 1–${MENU.length} (or blank to cancel): `)).trim();
    if (!answer) { console.log('\n  Cancelled.\n'); if (ownRl) rl.close(); return; }
    item = MENU[parseInt(answer, 10) - 1];
    if (!item) { console.log('\n  Invalid choice — returning to menu.\n'); if (ownRl) rl.close(); return; }
  }

  const providerKey = item.key;
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: providerKey }, null, 2));
  console.log(`\n  Active model switched to: ${item.label}`);

  // Check if session file exists
  const sFile = sessionFile(providerKey);
  if (!fs.existsSync(sFile)) {
    console.log(`\n  ⚠️  Warning: Session for ${item.label} is missing.`);
    const answer = (await question(rl, `  Would you like to log in now? (y/n): `)).trim().toLowerCase();
    if (answer.startsWith('y')) {
      await login(rl, providerKey);
    }
  } else {
    console.log(`  Session found: ✓\n`);
  }

  if (ownRl) rl.close();
}
