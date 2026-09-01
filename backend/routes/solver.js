import { Router } from 'express';
import { launchBrowser, newStealthContext } from '../src/browser.js';
import { solveAntiBotChallenge } from '../src/stealth.js';

const router = Router();

// Optional API key validation middleware
function authMiddleware(req, res, next) {
  const apiKey = process.env.LLM_API_KEY || process.env.API_KEY;
  if (!apiKey) return next();

  const reqKey = req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);
  if (reqKey !== apiKey) {
    return res.status(401).json({
      error: {
        message: 'Incorrect or missing API key provided.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }
  next();
}

router.use(authMiddleware);

/**
 * POST /api/v1/solve & /v1/solve
 * Universal endpoint to navigate to a protected URL, detect and solve Cloudflare/Turnstile bot challenges,
 * and return the page status, title, resolved URL, cookies, and optional screenshots.
 *
 * Body:
 * {
 *   "url": "https://protected-website.com",
 *   "timeout": 30000,
 *   "waitForSelector": "#target-element",
 *   "takeScreenshot": true,
 *   "extractHtml": false
 * }
 */
const solveHandler = async (req, res) => {
  const { url, timeout = 30000, waitForSelector = null, takeScreenshot = false, extractHtml = false } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({
      success: false,
      error: 'A valid "url" starting with http:// or https:// is required.'
    });
  }

  const startTime = Date.now();
  let browser = null;

  try {
    console.log(`\n[Solver API] Testing anti-bot detection for URL: ${url}`);
    
    // Launch stealth Playwright browser
    browser = await launchBrowser(false, 'stealth-solver', { forceAutomated: true });
    const ctx = await newStealthContext(browser);
    const page = await ctx.newPage();

    console.log(`[Solver API] Navigating...`);
    await page.goto(url, { timeout: Math.min(timeout, 45000), waitUntil: 'domcontentloaded' }).catch(() => {});

    // Run universal challenge detection & solver
    const solverResult = await solveAntiBotChallenge(page, { maxWaitMs: timeout, pollIntervalMs: 600 });

    if (waitForSelector) {
      try {
        await page.waitForSelector(waitForSelector, { visible: true, timeout: 10000 });
      } catch (e) {
        console.warn(`[Solver API] waitForSelector "${waitForSelector}" timed out: ${e.message}`);
      }
    }

    const finalUrl = page.url ? page.url() : url;
    const title = page.title ? await page.title() : '';
    const cookies = page.cookies ? await page.cookies() : [];
    
    let screenshotBase64 = null;
    if (takeScreenshot) {
      const buffer = await page.screenshot({ type: 'png' }).catch(() => null);
      if (buffer) {
        screenshotBase64 = `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
      }
    }

    let htmlContent = null;
    if (extractHtml) {
      htmlContent = await page.evaluate(() => document.documentElement.outerHTML).catch(() => null);
    }

    const timeElapsedMs = Date.now() - startTime;
    console.log(`[Solver API] Result: Solved=${solverResult.solved}, Type=${solverResult.challengeType || 'None'}, Time=${timeElapsedMs}ms, Title="${title}"\n`);

    await browser.close().catch(() => {});

    return res.json({
      success: true,
      url,
      finalUrl,
      title,
      challengeEncountered: !!solverResult.challengeType,
      challengeType: solverResult.challengeType,
      solved: solverResult.solved,
      timeElapsedMs,
      cookiesCount: cookies.length,
      cookies,
      screenshot: screenshotBase64,
      html: htmlContent
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[Solver API Error] ${err.message}`);
    return res.status(500).json({
      success: false,
      url,
      error: err.message,
      timeElapsedMs: Date.now() - startTime
    });
  }
};

router.post('/solve', solveHandler);
router.post('/api/v1/solve', solveHandler);
router.post('/v1/solve', solveHandler);

export default router;
