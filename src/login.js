import fs from 'fs';
import path from 'path';
import readline from 'readline';
import puppeteer from 'puppeteer-extra';
import { launchBrowser, readBrowserPref } from './browser.js';
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

    if (!answer) { console.log('\n  Cancelled.\n'); if (ownRl) rl.close(); return; }
    item = MENU[parseInt(answer, 10) - 1];
  }

  if (!item) { console.log('\n  Invalid choice — returning to menu.\n'); if (ownRl) rl.close(); return; }

  providerKey = item.key;
  const provider = getProvider(providerKey);

  console.log(`\n  A browser window will open → sign in to ${provider.config.name}.`);

  let browser;
  let page;
  let isCDP = false;

  try {
    // Try to connect to a manual Chrome instance running with remote debugging port 9222.
    // This is the most reliable way to bypass Google/Cloudflare bot protection.
    try {
      console.log('  Checking for manual Chrome on port 9222...');
      browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
      console.log('  ✓ Connected to running Chrome on port 9222!');
      isCDP = true;
      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();
    } catch (e) {
      console.log('  No manual Chrome on port 9222. Launching new browser...');
      browser = await launchBrowser(true, providerKey, { forceAutomated: true });
      page = await browser.newPage();
    }

    console.log(`  Navigating to ${provider.config.url}...`);
    await page.goto(provider.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    await question(rl, '  Once logged in, press ENTER here to save the session... ');

    console.log('  Saving session...');
    await new Promise(r => setTimeout(r, 3000));

    // Save cookies
    const cookies = await page.cookies();

    // Save localStorage
    const origin = new URL(provider.config.url).origin;
    const localStorageData = await page.evaluate(() => {
      const items = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        items.push({ name: key, value: window.localStorage.getItem(key) });
      }
      return items;
    });

    const storageState = {
      cookies: cookies.map(c => ({
        name:     c.name,
        value:    c.value,
        domain:   c.domain,
        path:     c.path,
        expires:  c.expires ?? -1,
        httpOnly: c.httpOnly ?? false,
        secure:   c.secure ?? false,
        sameSite: c.sameSite || 'None',
      })),
      origins: [{ origin, localStorage: localStorageData }],
    };

    const sFile = sessionFile(providerKey);
    fs.writeFileSync(sFile, JSON.stringify(storageState, null, 2));
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: providerKey }, null, 2));

    console.log(`\n  ✅ Logged in as ${provider.config.name}`);
    console.log(`     Session saved: ${sFile}`);
    console.log('     You can now use /chat and /apply.\n');
  } catch (e) {
    console.error('\n  ✗ Login failed:', e.message, '\n');
  } finally {
    if (browser && !isCDP) await browser.close();
    if (ownRl) rl.close();
  }
}

export async function selectModel(externalRl = null, modelArg = '') {
  const rl    = externalRl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ownRl = !externalRl;

  let item;
  const arg = modelArg.trim().toLowerCase();

  if (arg) {
    const idx = parseInt(arg, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= MENU.length) {
      item = MENU[idx - 1];
    } else {
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
