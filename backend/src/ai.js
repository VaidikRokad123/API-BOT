import fs from 'fs';
import { launchBrowser, newStealthContext } from './browser.js';
import { ACTIVE_FILE, sessionFile } from './config.js';
import { getProvider } from './providers/index.js';
import { solveAntiBotChallenge } from './stealth.js';

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

export function ensureSessionFromEnv(targetKey, sFile) {
  if (fs.existsSync(sFile)) return true;

  const envKeyBase64 = `SESSION_${targetKey.toUpperCase()}_BASE64`;
  const envKeyJson = `SESSION_${targetKey.toUpperCase()}_JSON`;

  const base64Data = process.env[envKeyBase64];
  const jsonData = process.env[envKeyJson];

  if (!base64Data && !jsonData) return false;

  try {
    const dir = path.dirname(sFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let rawContent = '';
    let sourceName = '';

    if (base64Data) {
      sourceName = envKeyBase64;
      try {
        rawContent = Buffer.from(base64Data.trim(), 'base64').toString('utf8');
      } catch (b64Err) {
        console.error(`  ✗ [Session Error] Failed to decode Base64 string from ${envKeyBase64}: ${b64Err.message}`);
        console.error(`  💡 Re-run 'npm run export-sessions' locally and copy the clean Base64 value.`);
        return false;
      }
    } else if (jsonData) {
      sourceName = envKeyJson;
      rawContent = jsonData.trim();
    }

    // Validate that rawContent is valid session JSON structure
    try {
      const parsed = JSON.parse(rawContent);
      if (typeof parsed !== 'object' || parsed === null || (!Array.isArray(parsed.cookies) && !Array.isArray(parsed.origins))) {
        throw new Error("JSON must contain 'cookies' or 'origins' array (Playwright storageState shape).");
      }

      fs.writeFileSync(sFile, JSON.stringify(parsed, null, 2), 'utf8');
      console.log(`  ✓ Restored and validated ${targetKey} session from ${sourceName}.`);
      return true;
    } catch (jsonErr) {
      console.error(`  ✗ [Session Error] Invalid session JSON in ${sourceName}: ${jsonErr.message}`);
      console.error(`  💡 Environment variable ${sourceName} contains corrupted or invalid session data.`);
      return false;
    }
  } catch (err) {
    console.error(`  ✗ [Session Error] Error setting up ${targetKey} session from env:`, err.message);
    return false;
  }
}

/**
 * Hydrates all provider sessions from environment variables at startup.
 */
export function hydrateAllSessionsFromEnv() {
  const providers = ['chatgpt', 'grok', 'gemini', 'perplexity', 'deepseek'];
  let restored = 0;
  for (const key of providers) {
    const sFile = sessionFile(key);
    if (ensureSessionFromEnv(key, sFile)) {
      restored++;
    }
  }
  return restored;
}


export async function openAiSession(visible = false, options = {}) {
  const targetKey = options.provider || readActiveKey();
  const provider = getProvider(targetKey);
  const sFile    = sessionFile(targetKey);

  ensureSessionFromEnv(targetKey, sFile);

  if (!fs.existsSync(sFile)) {
    const envVar = `SESSION_${targetKey.toUpperCase()}_BASE64`;
    const msg = `No session for ${provider.config.name} (${targetKey}). Session file missing or ${envVar} environment variable is invalid/missing.`;
    console.error(`  ✗ [Session Error] ${msg}`);
    throw new Error(msg);
  }

  _providerKey = targetKey;
  const browser = await launchBrowser(visible, targetKey, { engine: options.engine, forceAutomated: true });
  const ctx     = await newStealthContext(browser, sFile);
  const page    = await ctx.newPage();

  process.stdout.write(`[AI] Connecting to ${provider.config.name}... `);
  await page.goto(provider.config.url);

  try {
    const landingUrl = page.url ? page.url() : '';
    console.log(`[AI Navigated to: ${landingUrl}]`);

    // Run universal challenge detection & solver (Cloudflare Turnstile, Interstitials, Popups)
    await solveAntiBotChallenge(page, { maxWaitMs: 30000, pollIntervalMs: 800 });

    await page.waitForSelector(provider.config.readySelector, { timeout: 30000 });
    console.log('Ready ✓\n');
  } catch (waitErr) {
    const currentUrl = page.url ? page.url() : 'unknown';
    const currentTitle = page.title ? await page.title().catch(() => 'unknown') : 'unknown';
    await browser.close().catch(() => {});

    const envVar = `SESSION_${targetKey.toUpperCase()}_BASE64`;
    const errMsg = `Session expired or invalid for ${provider.config.name} (${targetKey}). Page URL: '${currentUrl}', Title: '${currentTitle}'. Error: ${waitErr.message}`;
    console.error(`  ✗ [Login Error] ${errMsg}`);
    throw new Error(errMsg);
  }

  return { browser, page, providerName: provider.config.name, providerKey: targetKey };
}

export async function sendMessage(page, text, providerKey = null) {
  const key      = providerKey || _providerKey || readActiveKey();
  const provider = getProvider(key);

  // If a challenge or popup appeared mid-session, automatically resolve it before typing
  await solveAntiBotChallenge(page, { maxWaitMs: 15000, pollIntervalMs: 600 }).catch(() => {});

  return provider.sendMessage(page, text);
}
