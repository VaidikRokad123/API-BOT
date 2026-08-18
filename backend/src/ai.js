import fs from 'fs';
import { launchBrowser, newStealthContext } from './browser.js';
import { ACTIVE_FILE, sessionFile } from './config.js';
import { getProvider } from './providers/index.js';

// Active provider key for this process — set once by openAiSession().
let _providerKey = null;

export function readActiveKey() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8')).provider || 'chatgpt';
  } catch {
    return 'chatgpt'; // backward compat: no active.json → assume chatgpt
  }
}

export async function openAiSession(visible = false, options = {}) {
  const targetKey = options.provider || readActiveKey();
  const provider = getProvider(targetKey);
  const sFile    = sessionFile(targetKey);

  if (!fs.existsSync(sFile)) {
    throw new Error(`No session for ${provider.config.name} (${targetKey}). Please login to ${provider.config.name} first.`);
  }

  _providerKey = targetKey;
  const browser = await launchBrowser(visible, targetKey, { engine: options.engine, forceAutomated: true });
  const ctx     = await newStealthContext(browser, sFile);
  const page    = await ctx.newPage();

  process.stdout.write(`[AI] Connecting to ${provider.config.name}... `);
  await page.goto(provider.config.url);

  try {
    await page.waitForSelector(provider.config.readySelector, { timeout: 15000 });
    console.log('Ready ✓\n');
  } catch {
    await browser.close();
    throw new Error(`Login expired for ${provider.config.name}. Please login to ${provider.config.name} again.`);
  }

  return { browser, page, providerName: provider.config.name, providerKey: targetKey };
}

export async function sendMessage(page, text, providerKey = null) {
  const key      = providerKey || _providerKey || readActiveKey();
  const provider = getProvider(key);
  return provider.sendMessage(page, text);
}
