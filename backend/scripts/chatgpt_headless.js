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

  // Check if --visible flag is passed (shows the browser window fully)
  const isVisible = process.argv.includes('--visible');
  console.log(`[Playwright] Launching browser (${isVisible ? 'visible' : 'minimized background'})...`);

  // IMPORTANT: We always launch headless:false because Cloudflare blocks headless Chrome.
  // Instead we use --start-minimized to keep the window in the taskbar, invisible to user.
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(isVisible ? [] : ['--start-minimized']),
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

    console.log('[Playwright] Message sent. Waiting for page navigation to settle...');

    // ChatGPT navigates to a new URL (e.g. /c/abc123) after sending.
    // We must wait for that navigation to complete before querying.
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (e) {
      // networkidle can timeout on slow connections, that's OK — continue
    }

    console.log('[Playwright] Page settled. Waiting for response generation to finish...');

    // Poll: wait until the Stop button disappears (it shows during generation)
    // and wait for at least one .markdown response block to appear.
    // Timeout: 120 seconds for long responses.
    const maxWait = 120000;
    const pollInterval = 1500;
    const startTime = Date.now();
    let responseText = '';

    while (Date.now() - startTime < maxWait) {
      await page.waitForTimeout(pollInterval);

      // Check if a "stop" button is still visible (generation is still running)
      const stopButton = page.locator('button[data-testid="stop-button"]');
      const isGenerating = await stopButton.count() > 0;

      if (!isGenerating) {
        // Generation appears done — try to extract the last response block
        const markdownBlocks = page.locator('.markdown');
        const count = await markdownBlocks.count();

        if (count > 0) {
          const candidate = await markdownBlocks.last().innerText();
          if (candidate && candidate.trim().length > 0) {
            // Confirm it is stable by waiting one more cycle and checking again
            await page.waitForTimeout(1000);
            const confirmed = await markdownBlocks.last().innerText();
            if (confirmed === candidate) {
              responseText = confirmed.trim();
              break;
            }
          }
        }
      }
    }

    if (!responseText) {
      throw new Error('Timed out waiting for ChatGPT response. The page may have had an issue.');
    }

    console.log('[Playwright] Response received. Extracting text...');
    return responseText;

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

// Interactive REPL loop
async function interactiveChat() {
  const readline = (await import('readline')).default;
  const isVisible = process.argv.includes('--visible');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n============================================');
  console.log('  ChatGPT Interactive Console');
  console.log('============================================');
  console.log('  Type your message and press Enter.');
  console.log('  Type "exit" or press Ctrl+C to quit.');
  console.log('============================================\n');

  const ask = () => {
    rl.question('You: ', async (input) => {
      const prompt = input.trim();

      if (!prompt) {
        ask();
        return;
      }

      if (prompt.toLowerCase() === 'exit') {
        console.log('\nGoodbye!');
        rl.close();
        process.exit(0);
      }

      try {
        // Temporarily inject --visible into argv if flag was set
        if (isVisible && !process.argv.includes('--visible')) {
          process.argv.push('--visible');
        }

        process.stdout.write('\nGPT: [thinking...]\r');
        const response = await askChatGPT(prompt);

        // Clear the thinking line and print response
        process.stdout.write('\x1B[2K\r'); // Clear current line
        console.log('\nGPT: ' + response);
        console.log('\n' + '─'.repeat(50));
      } catch (err) {
        console.error('\n[Error]', err.message);
      }

      // Continue asking
      ask();
    });
  };

  ask();

  // Handle Ctrl+C cleanly
  rl.on('close', () => {
    console.log('\nSession ended. Goodbye!');
    process.exit(0);
  });
}

// Support running directly from command line
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];

  if (mode === 'login') {
    setupSession();
  } else if (mode === 'test') {
    // Single-shot test with a prompt from CLI args
    const testPrompt = process.argv[3] || 'Hello, reply in 5 words.';
    console.log(`[Test] Sending: "${testPrompt}"`);
    askChatGPT(testPrompt)
      .then(res => {
        console.log('\n─── ChatGPT Response ─────────────────────────');
        console.log(res);
        console.log('──────────────────────────────────────────────');
      })
      .catch(err => {
        console.error('\n[Test] Failed:', err.message);
      });
  } else if (mode === 'chat') {
    // Interactive persistent chat loop
    interactiveChat();
  } else {
    console.log('');
    console.log('Usage:');
    console.log('  node chatgpt_headless.js login             Log in and save session');
    console.log('  node chatgpt_headless.js test "prompt"     Send one message and exit');
    console.log('  node chatgpt_headless.js chat              Interactive chat loop (stays open)');
    console.log('  Add --visible to any command to show the browser window');
    console.log('');
  }
}
