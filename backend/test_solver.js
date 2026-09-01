#!/usr/bin/env node

/**
 * CLI Test Script for Anti-Bot & Cloudflare Detection Solver
 * Usage: node backend/test_solver.js <url> [--visible]
 */

import { launchBrowser, newStealthContext } from './src/browser.js';
import { solveAntiBotChallenge } from './src/stealth.js';

const targetUrl = process.argv[2] || 'https://nowsecure.nl';
const isVisible = process.argv.includes('--visible') || process.argv.includes('-v');

console.log('\n================================================================');
console.log('       ANTI-BOT DETECTION & CLOUDFLARE SOLVER TEST');
console.log('================================================================');
console.log(` Target URL : ${targetUrl}`);
console.log(` Mode       : ${isVisible ? 'Headful (Visible GUI)' : 'Headless (Stealth)'}\n`);

async function runTest() {
  const startTime = Date.now();
  let browser = null;

  try {
    console.log('[1/4] Launching Stealth Playwright Browser...');
    browser = await launchBrowser(isVisible, 'test-solver', { forceAutomated: true });
    
    console.log('[2/4] Initializing Stealth Context & Prototypes...');
    const ctx = await newStealthContext(browser);
    const page = await ctx.newPage();

    console.log(`[3/4] Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });

    console.log('[4/4] Running Universal Anti-Bot & Turnstile Solver...');
    const result = await solveAntiBotChallenge(page, { maxWaitMs: 30000, pollIntervalMs: 800 });

    const finalUrl = page.url ? page.url() : targetUrl;
    const title = page.title ? await page.title() : 'unknown';
    const cookies = page.cookies ? await page.cookies() : [];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n================================================================');
    console.log('                          TEST RESULTS                          ');
    console.log('================================================================');
    console.log(` Status               : ${result.solved ? 'PASSED ✓' : 'FAILED ✗'}`);
    console.log(` Challenge Detected   : ${result.challengeType || 'None'}`);
    console.log(` Final URL            : ${finalUrl}`);
    console.log(` Page Title           : "${title}"`);
    console.log(` Cookies Captured     : ${cookies.length} cookie(s)`);
    console.log(` Time Elapsed         : ${elapsed}s`);
    console.log('================================================================\n');

    await browser.close().catch(() => {});
    process.exit(result.solved ? 0 : 1);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`\n✗ [Test Error] ${err.message}\n`);
    process.exit(1);
  }
}

runTest();
