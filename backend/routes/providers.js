import { Router } from 'express';
import fs from 'fs';
import { ACTIVE_FILE, sessionFile } from '../src/config.js';
import { saveBrowserPref, getEngineList } from '../src/browser.js';
import { MENU } from '../src/login.js';

const router = Router();

// List all providers with session status
router.get('/providers', (req, res) => {
  try {
    let activeProvider = null;
    try {
      activeProvider = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8')).provider;
    } catch { /* none */ }

    const providers = MENU.map(p => ({
      key: p.key,
      label: p.label,
      host: p.host,
      hasSession: fs.existsSync(sessionFile(p.key)),
      isActive: p.key === activeProvider
    }));

    res.json({ providers, activeProvider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch active provider
router.post('/model', (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider is required' });

    const item = MENU.find(p => p.key === provider || p.label.toLowerCase() === provider.toLowerCase());
    if (!item) return res.status(400).json({ error: `Invalid provider: ${provider}` });

    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: item.key }, null, 2));
    res.json({ success: true, provider: item.key, label: item.label, hasSession: fs.existsSync(sessionFile(item.key)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch browser engine
router.post('/browser', (req, res) => {
  try {
    const { engine } = req.body;
    const engines = getEngineList();
    const match = engines.find(e => e.key === engine);
    if (!match) return res.status(400).json({ error: `Invalid engine: ${engine}` });

    saveBrowserPref(engine);
    res.json({ success: true, engine: match.key, name: match.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login — open browser for manual login
router.post('/login/start', async (req, res) => {
  try {
    const { provider } = req.body;
    const item = MENU.find(p => p.key === provider);
    if (!item) return res.status(400).json({ error: `Invalid provider: ${provider}` });

    const { getProvider } = await import('../src/providers/index.js');
    const prov = getProvider(item.key);
    const { launchBrowser } = await import('../src/browser.js');
    const browser = await launchBrowser(true, item.key, { forceAutomated: true });
    const page = await browser.newPage();
    await page.goto(prov.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    global.__loginBrowser = browser;
    global.__loginPage = page;
    global.__loginProvider = item.key;

    res.json({ success: true, message: `Browser opened for ${item.label}. Log in, then call POST /api/login/save`, provider: item.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login — save session after manual login
router.post('/login/save', async (req, res) => {
  try {
    const browser = global.__loginBrowser;
    const page = global.__loginPage;
    const providerKey = global.__loginProvider;
    if (!browser || !page || !providerKey) return res.status(400).json({ error: 'No active login session. Call POST /api/login/start first.' });

    const { getProvider } = await import('../src/providers/index.js');
    const prov = getProvider(providerKey);
    await new Promise(r => setTimeout(r, 3000));

    const cookies = await page.cookies();
    const origin = new URL(prov.config.url).origin;
    const localStorageData = await page.evaluate(() => {
      const items = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        items.push({ name: key, value: window.localStorage.getItem(key) });
      }
      return items;
    });

    const storageState = {
      cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires ?? -1, httpOnly: c.httpOnly ?? false, secure: c.secure ?? false, sameSite: c.sameSite || 'None' })),
      origins: [{ origin, localStorage: localStorageData }],
    };

    fs.writeFileSync(sessionFile(providerKey), JSON.stringify(storageState, null, 2));
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: providerKey }, null, 2));
    await browser.close().catch(() => {});
    global.__loginBrowser = null;
    global.__loginPage = null;
    global.__loginProvider = null;

    res.json({ success: true, message: `Session saved for ${prov.config.name}`, provider: providerKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
