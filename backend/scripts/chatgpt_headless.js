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
  console.log('Once you are logged in and see the chat input box, the session will be saved.');
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: false, // Visible window so user can log in
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://chatgpt.com');

  console.log('[Setup] Waiting for login completion (input field to appear)...');

  try {
    // Wait for the chat text area to appear (means user is logged in)
    await page.waitForSelector('#prompt-textarea', { timeout: 300000 }); // 5 minutes timeout

    console.log('[Setup] Login detected! Saving session state...');
    
    // Small sleep to ensure session state updates
    await page.waitForTimeout(3000);

    // Save cookies and storage state to D: drive
    await context.storageState({ path: sessionPath });
    console.log(`[Setup] Success! Session saved to: ${sessionPath}`);
  } catch (error) {
    console.error('[Setup] Error during login setup:', error.message);
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
  });

  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
