import fs from 'fs';
import { launchBrowser, newStealthContext } from './browser.js';
import { SESSION_FILE } from './config.js';

export async function openGptSession(visible = false) {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error('No session found. Run:  node agent.js login  first.');
  }

  const browser = await launchBrowser(visible);
  const ctx     = await newStealthContext(browser, SESSION_FILE);
  const page    = await ctx.newPage();

  process.stdout.write('[GPT] Connecting to chatgpt.com... ');
  await page.goto('https://chatgpt.com');

  try {
    await page.waitForSelector('#prompt-textarea', { timeout: 15000 });
    console.log('Ready ✓\n');
  } catch {
    await browser.close();
    throw new Error('Login expired. Run:  node agent.js login  again.');
  }

  return { browser, page };
}

export async function sendMessage(page, prompt) {
  const textarea = page.locator('#prompt-textarea');
  await textarea.click();
  await textarea.fill(prompt);

  const sendBtn = page.locator('button[data-testid="send-button"]');
  await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
  await sendBtn.click();

  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch { /* ok */ }

  const MAX_WAIT  = 120_000;
  const POLL      = 500;
  const STABLE_MS = 1500;
  const start     = Date.now();
  let lastText = '', stableFor = 0;

  while (Date.now() - start < MAX_WAIT) {
    await page.waitForTimeout(POLL);

    if (await page.locator('button[data-testid="stop-button"]').count() > 0) {
      stableFor = 0; continue;
    }

    const blocks = page.locator('.markdown');
    if (!await blocks.count()) continue;

    const text = await blocks.last().innerText();
    if (!text?.trim()) continue;

    if (text === lastText) {
      stableFor += POLL;
      if (stableFor >= STABLE_MS) return text.trim();
    } else {
      lastText = text; stableFor = 0;
    }
  }
  throw new Error('Timed out waiting for ChatGPT response.');
}
