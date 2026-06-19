import { chromium } from 'playwright';
import { STEALTH_ARGS, newStealthContext } from './browser.js';
import { SESSION_FILE } from './config.js';

export async function login() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      ChatGPT Session Login Setup       ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('\nA Chrome window will open.');
  console.log('→ Sign in to your ChatGPT account.');
  console.log('→ Once fully logged in, come back here and press ENTER.\n');

  const browser = await chromium.launch({ headless: false, args: STEALTH_ARGS });
  const ctx     = await newStealthContext(browser);
  const page    = await ctx.newPage();
  await page.goto('https://chatgpt.com');

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });

  try {
    await ctx.storageState({ path: SESSION_FILE });
    console.log(`\n✅ Session saved to: ${SESSION_FILE}`);
    console.log('   You can now use "chat" and "apply" commands.\n');
  } catch (e) {
    console.error('✗ Failed to save session:', e.message);
  } finally {
    await browser.close();
  }
}
