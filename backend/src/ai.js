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

import path from 'path';

function ensureSessionFromEnv(targetKey, sFile) {
  if (fs.existsSync(sFile)) return;

  const envKeyBase64 = `SESSION_${targetKey.toUpperCase()}_BASE64`;
  const envKeyJson = `SESSION_${targetKey.toUpperCase()}_JSON`;

  const base64Data = process.env[envKeyBase64];
  const jsonData = process.env[envKeyJson];

  try {
    const dir = path.dirname(sFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (base64Data) {
      const decoded = Buffer.from(base64Data, 'base64').toString('utf8');
      fs.writeFileSync(sFile, decoded, 'utf8');
      console.log(`  ✓ Restored ${targetKey} session from ${envKeyBase64} env var.`);
    } else if (jsonData) {
      fs.writeFileSync(sFile, jsonData, 'utf8');
      console.log(`  ✓ Restored ${targetKey} session from ${envKeyJson} env var.`);
    }
  } catch (err) {
    console.error(`  ✗ Error restoring ${targetKey} session from env:`, err.message);
  }
}

export async function openAiSession(visible = false, options = {}) {
  const targetKey = options.provider || readActiveKey();
  const provider = getProvider(targetKey);
  const sFile    = sessionFile(targetKey);

  ensureSessionFromEnv(targetKey, sFile);

  if (!fs.existsSync(sFile)) {
    throw new Error(`No session for ${provider.config.name} (${targetKey}). Please login to ${provider.config.name} first or set SESSION_${targetKey.toUpperCase()}_BASE64 environment variable.`);
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
