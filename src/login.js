import fs from 'fs';
import readline from 'readline';
import { chromium } from 'playwright';
import { STEALTH_ARGS, newStealthContext } from './browser.js';
import { ACTIVE_FILE, sessionFile } from './config.js';
import { getProvider, PROVIDERS } from './providers/index.js';

const MENU = [
  { key: 'chatgpt',    label: 'ChatGPT',    host: 'chatgpt.com'          },
  { key: 'grok',       label: 'Grok',       host: 'grok.com'             },
  { key: 'gemini',     label: 'Gemini',     host: 'gemini.google.com'    },
  { key: 'perplexity', label: 'Perplexity', host: 'perplexity.ai'        },
];

async function selectProvider() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Choose Your AI Provider               ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  MENU.forEach((p, i) => {
    const pad = p.label.padEnd(12);
    console.log(`  ${i + 1})  ${pad}  ${p.host}`);
  });
  console.log();

  return new Promise((resolve) => {
    rl.question('  Enter 1–4: ', (answer) => {
      rl.close();
      const item = MENU[parseInt(answer, 10) - 1];
      if (!item) {
        console.error('\nInvalid choice. Run login again.');
        process.exit(1);
      }
      resolve(item.key);
    });
  });
}

export async function login() {
  const providerKey = await selectProvider();
  const provider    = getProvider(providerKey);

  console.log(`\nA browser window will open → sign in to ${provider.config.name}.`);
  console.log('Once you see your chat interface, come back here and press ENTER.\n');

  const browser = await chromium.launch({ headless: false, args: STEALTH_ARGS });
  const ctx     = await newStealthContext(browser);
  const page    = await ctx.newPage();
  await page.goto(provider.config.url);

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });

  try {
    // Wait for background iframes (auth, payment scripts) to settle before saving.
    // storageState() fails if a frame is mid-navigation when it's called.
    console.log('  Saving session...');
    await page.waitForTimeout(3000);

    const sFile = sessionFile(providerKey);

    // Retry once — some providers load heavy iframe trees that need extra time.
    try {
      await ctx.storageState({ path: sFile });
    } catch {
      await page.waitForTimeout(3000);
      await ctx.storageState({ path: sFile });
    }

    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: providerKey }, null, 2));

    console.log(`\n✅ Logged in as: ${provider.config.name}`);
    console.log(`   Session saved : ${sFile}`);
    console.log('   You can now run "chat" and "apply" commands.\n');
  } catch (e) {
    console.error('✗ Failed to save session:', e.message);
  } finally {
    await browser.close();
  }
}
