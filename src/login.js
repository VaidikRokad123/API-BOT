import fs from 'fs';
import readline from 'readline';
import { chromium } from 'playwright';
import { STEALTH_ARGS, newStealthContext } from './browser.js';
import { ACTIVE_FILE, sessionFile } from './config.js';
import { getProvider } from './providers/index.js';

const MENU = [
  { key: 'chatgpt',    label: 'ChatGPT',    host: 'chatgpt.com'       },
  { key: 'grok',       label: 'Grok',       host: 'grok.com'          },
  { key: 'gemini',     label: 'Gemini',     host: 'gemini.google.com' },
  { key: 'perplexity', label: 'Perplexity', host: 'perplexity.ai'     },
  { key: 'deepseek',   label: 'DeepSeek',   host: 'chat.deepseek.com' },
];

const question = (rl, q) => new Promise((resolve) => rl.question(q, resolve));

// externalRl — the REPL's readline. We MUST reuse it; creating a second
// interface on the same stdin garbles input. When null (standalone), we own one.
export async function login(externalRl = null) {
  const rl    = externalRl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ownRl = !externalRl;

  console.log('\n  ╔══════════════════════════════════════════════╗');
  console.log('  ║          Choose Your AI Provider             ║');
  console.log('  ╚══════════════════════════════════════════════╝\n');
  MENU.forEach((p, i) => console.log(`    ${i + 1})  ${p.label.padEnd(12)}  ${p.host}`));
  console.log();

  const answer = (await question(rl, `  Enter 1–${MENU.length} (or blank to cancel): `)).trim();

  // Graceful aborts — never kill the REPL on a typo.
  if (!answer) { console.log('\n  Cancelled.\n'); if (ownRl) rl.close(); return; }
  const item = MENU[parseInt(answer, 10) - 1];
  if (!item) { console.log('\n  Invalid choice — returning to menu.\n'); if (ownRl) rl.close(); return; }

  const providerKey = item.key;
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
