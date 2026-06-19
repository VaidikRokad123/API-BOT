import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionPath = path.join(__dirname, 'session.json');

// Ensure Playwright uses a local D:\ directory for browsers if set by user
if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
}

export async function setupSession() {
  console.log('====================================================');
  console.log('ChatGPT Headless Browser Login Session Setup');
  console.log('====================================================');
  console.log('Starting headful Chrome browser...');
  console.log('Please log in to your ChatGPT account in the browser window.');
  console.log('Ensure you click Log In and are fully signed in.');
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: false, // Visible window so user can log in
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  // Inject stealth script to bypass Cloudflare turnstile
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  await page.goto('https://chatgpt.com');

  console.log('\n[Action Required]');
  console.log('1. Go to the opened Chrome browser.');
  console.log('2. Sign in to your ChatGPT account.');
  console.log('3. Once you are fully logged in and see the chat history/sidebar,');
  console.log('   return to this terminal and press [ENTER] to save your session.');
  console.log('====================================================');

  // Wait for manual confirmation via stdin
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });

  try {
    console.log('[Setup] Saving session state...');
    
    // Save cookies and storage state to D: drive
    await context.storageState({ path: sessionPath });
    console.log(`[Setup] Success! Session saved to: ${sessionPath}`);
  } catch (error) {
    console.error('[Setup] Error saving session state:', error.message);
  } finally {
    await browser.close();
  }
}

export async function askChatGPT(prompt) {
  if (!fs.existsSync(sessionPath)) {
    throw new Error('No active session found. Please run "npm run login" first to log in to ChatGPT.');
  }

  // Launch browser in headless (hidden) mode
  const browser = await chromium.launch({
    headless: true, // Invisible background window!
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    // Inject stealth script in headless context as well
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    const page = await context.newPage();
    
    // Go to ChatGPT
    await page.goto('https://chatgpt.com');

    // Wait for text input area
    try {
      await page.waitForSelector('#prompt-textarea', { timeout: 15000 });
    } catch (e) {
      throw new Error('ChatGPT session expired. Please re-run "npm run login" to update your credentials.');
    }

    // Input prompt
    const textarea = page.locator('#prompt-textarea');
    await textarea.fill(prompt);

    // Wait for send button to be ready and click it
    const sendButton = page.locator('button[data-testid="send-button"]');
    await sendButton.waitFor({ state: 'visible', timeout: 5000 });
    await sendButton.click();

    console.log('[Playwright] Message sent. Waiting for response to generate...');

    // Wait for response to finish. 
    // During generation, the send button disappears or is replaced by a stop button, 
    // and when complete, the send button appears again and becomes enabled (not disabled).
    // We check for: data-testid="send-button" and not having disabled attribute
    await page.waitForSelector('button[data-testid="send-button"]:not([disabled])', { timeout: 90000 });

    // Wait an extra half second to let elements stabilize
    await page.waitForTimeout(800);

    // Extract the text of the last markdown block (which is ChatGPT's response)
    const markdownBlocks = page.locator('.markdown');
    const count = await markdownBlocks.count();
    
    if (count === 0) {
      throw new Error('Could not find any response text block in the chat.');
    }

    const responseText = await markdownBlocks.last().innerText();
    return responseText.trim();

  } catch (error) {
    console.error('[Playwright] Automation error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Support running directly from command line for testing
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'login') {
    setupSession();
  } else if (mode === 'test') {
    const testPrompt = process.argv[3] || 'Hello, reply in 5 words.';
    console.log(`[Test] Sending test prompt: "${testPrompt}"`);
    askChatGPT(testPrompt)
      .then(res => {
        console.log('\n--- ChatGPT Response ---');
        console.log(res);
        console.log('------------------------');
      })
      .catch(err => {
        console.error('\n[Test] Test run failed:', err.message);
      });
  } else {
    console.log('Usage:');
    console.log('  node chatgpt_headless.js login    (Starts headful browser for login)');
    console.log('  node chatgpt_headless.js test     (Tests prompt query in headless mode)');
  }
}
