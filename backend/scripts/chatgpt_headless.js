import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const sessionPath = path.join(__dirname, 'session.json');

// ─── Stealth Launch Args ────────────────────────────────────────────────────
const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
];

const STEALTH_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
};

// ─── One-time Login Setup ───────────────────────────────────────────────────
export async function setupSession() {
  console.log('\n====================================================');
  console.log('  ChatGPT Session Setup');
  console.log('====================================================');
  console.log('A browser window will open. Sign in to ChatGPT.');
  console.log('Once fully logged in, come back here and press ENTER.');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    headless: false,
    args: STEALTH_ARGS,
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(STEALTH_SCRIPT);

  const page = await context.newPage();
  await page.goto('https://chatgpt.com');

  console.log('[Action Required]');
  console.log('1. Log in to your ChatGPT account in the browser.');
  console.log('2. Once you see your chat history, press ENTER here.\n');

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });

  try {
    await context.storageState({ path: sessionPath });
    console.log(`\n✓ Session saved to: ${sessionPath}`);
  } catch (e) {
    console.error('✗ Failed to save session:', e.message);
  } finally {
    await browser.close();
  }
}

// ─── Open a Persistent Browser Session ─────────────────────────────────────
export async function openSession(visible = false) {
  if (!fs.existsSync(sessionPath)) {
    throw new Error('No session found. Run "npm run login" first.');
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      ...STEALTH_ARGS,
      ...(visible ? [] : ['--start-minimized']),
    ],
  });

  const context = await browser.newContext({
    storageState: sessionPath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(STEALTH_SCRIPT);

  const page = await context.newPage();
  console.log('[Session] Navigating to chatgpt.com...');
  await page.goto('https://chatgpt.com');

  // Verify we are logged in
  try {
    await page.waitForSelector('#prompt-textarea', { timeout: 15000 });
  } catch {
    await browser.close();
    throw new Error('Could not find input. Session may have expired. Run "npm run login" again.');
  }

  console.log('[Session] Ready.\n');
  return { browser, page };
}

// ─── Send a Message on an Existing Page ────────────────────────────────────
export async function sendMessage(page, prompt) {
  // Type into the existing conversation (ChatGPT keeps context)
  const textarea = page.locator('#prompt-textarea');
  await textarea.click();
  await textarea.fill(prompt);

  const sendBtn = page.locator('button[data-testid="send-button"]');
  await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
  await sendBtn.click();

  // Wait for page navigation (ChatGPT redirects to /c/... on first message)
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch { /* ignore timeout — just continue */ }

  // Fast-poll: check every 500ms if stop button is gone + response is stable
  const maxWait = 120_000;
  const fastPoll = 500;
  const start = Date.now();
  let lastText = '';
  let stableFor = 0;
  const STABLE_MS = 1500; // must be unchanged for 1.5s to count as done

  while (Date.now() - start < maxWait) {
    await page.waitForTimeout(fastPoll);

    // If stop button still visible, generation is in progress
    const stopping = await page.locator('button[data-testid="stop-button"]').count();
    if (stopping > 0) {
      stableFor = 0; // reset stability timer
      continue;
    }

    // No stop button — check the last response block
    const blocks = page.locator('.markdown');
    const count = await blocks.count();
    if (count === 0) continue;

    const currentText = await blocks.last().innerText();
    if (!currentText?.trim()) continue;

    if (currentText === lastText) {
      stableFor += fastPoll;
      if (stableFor >= STABLE_MS) {
        return currentText.trim(); // ✓ Stable — return it
      }
    } else {
      lastText = currentText;
      stableFor = 0; // text changed, reset
    }
  }

  throw new Error('Timed out waiting for ChatGPT response.');
}

// ─── Single-shot API helper (used by Express server) ───────────────────────
export async function askChatGPT(prompt) {
  const { browser, page } = await openSession(process.argv.includes('--visible'));
  try {
    return await sendMessage(page, prompt);
  } finally {
    await browser.close();
  }
}

// ─── Interactive Chat Loop (persistent session) ─────────────────────────────
async function interactiveChat() {
  const readline = (await import('readline')).default;
  const visible = process.argv.includes('--visible');

  let browser, page;
  try {
    ({ browser, page } = await openSession(visible));
  } catch (e) {
    console.error('✗', e.message);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('============================================');
  console.log('  ChatGPT Interactive Console');
  console.log('  Browser open — messages share memory!');
  console.log('  Type "exit" or Ctrl+C to quit.');
  console.log('============================================\n');

  const ask = () => {
    rl.question('You: ', async input => {
      const prompt = input.trim();
      if (!prompt) { ask(); return; }

      if (prompt.toLowerCase() === 'exit') {
        console.log('\nClosing browser and exiting...');
        await browser.close();
        rl.close();
        process.exit(0);
      }

      try {
        process.stdout.write('GPT: thinking...\r');
        const response = await sendMessage(page, prompt);
        process.stdout.write('\x1B[2K\r'); // clear "thinking" line
        console.log('GPT: ' + response);
        console.log('─'.repeat(50) + '\n');
      } catch (e) {
        console.error('\n[Error]', e.message, '\n');
      }

      ask();
    });
  };

  ask();

  rl.on('close', async () => {
    await browser.close();
    process.exit(0);
  });
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];

  if (mode === 'login') {
    setupSession();
  } else if (mode === 'test') {
    const prompt = process.argv[3] || 'Hello, reply in 5 words.';
    console.log(`[Test] Sending: "${prompt}"\n`);
    askChatGPT(prompt)
      .then(r => { console.log('GPT: ' + r); })
      .catch(e => { console.error('[Error]', e.message); });
  } else if (mode === 'chat') {
    interactiveChat();
  } else {
    console.log('\nUsage:');
    console.log('  node chatgpt_headless.js login          Log in and save session');
    console.log('  node chatgpt_headless.js test "prompt"  Send one message and exit');
    console.log('  node chatgpt_headless.js chat           Interactive loop with memory');
    console.log('  Add --visible to any command to show the browser\n');
  }
}
