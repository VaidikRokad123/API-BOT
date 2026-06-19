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

  // Check if --visible flag is passed
  const isHeadless = !process.argv.includes('--visible');
  console.log(`[Playwright] Launching browser (headless: ${isHeadless})...`);

  // Launch browser
  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  let page;
  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    // Inject stealth script
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    page = await context.newPage();
    
    console.log('[Playwright] Navigating to https://chatgpt.com...');
    await page.goto('https://chatgpt.com');

    // Wait for text input area
    console.log('[Playwright] Waiting for input selector (#prompt-textarea)...');
    try {
      await page.waitForSelector('#prompt-textarea', { timeout: 15000 });
    } catch (e) {
      throw new Error('ChatGPT page input (#prompt-textarea) not found. Your session may have expired. Please run "npm run login" again.');
    }

    // Input prompt
    console.log('[Playwright] Typing prompt...');
    const textarea = page.locator('#prompt-textarea');
    await textarea.fill(prompt);

    // Wait for send button to be ready and click it
    console.log('[Playwright] Clicking send button...');
    const sendButton = page.locator('button[data-testid="send-button"]');
    await sendButton.waitFor({ state: 'visible', timeout: 5000 });
    await sendButton.click();

    console.log('[Playwright] Message sent. Waiting for response to complete (this may take up to 90 seconds)...');

    // Wait for response to finish
    await page.waitForSelector('button[data-testid="send-button"]:not([disabled])', { timeout: 90000 });

    // Wait an extra half second to let elements stabilize
    await page.waitForTimeout(800);

    // Extract the text of the last markdown block
    const markdownBlocks = page.locator('.markdown');
    const count = await markdownBlocks.count();
    
    if (count === 0) {
      throw new Error('No response text block (.markdown) was found on the page.');
    }

    console.log('[Playwright] Response received. Extracting text...');
    const responseText = await markdownBlocks.last().innerText();
    return responseText.trim();

  } catch (error) {
    console.error('[Playwright] Automation failed:', error.message);
    
    // Save screenshot for debugging
    if (page) {
      const screenshotPath = path.join(process.cwd(), 'debug_screenshot.png');
      try {
        await page.screenshot({ path: screenshotPath });
        console.log(`[Playwright] DEBUG: Captured screenshot of the stuck browser state to: ${screenshotPath}`);
      } catch (e) {
        console.error('[Playwright] Could not capture debug screenshot:', e.message);
      }
    }
    throw error;
  } finally {
    await browser.close();
    console.log('[Playwright] Browser closed.');
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
