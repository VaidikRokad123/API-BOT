import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { ACTIVE_FILE, sessionFile } from '../src/config.js';
import { saveBrowserPref, saveAiBrowserPref, getEngineList } from '../src/browser.js';
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
    if (match.blocked) return res.status(400).json({ error: `${match.name} is currently blocked.` });

    saveBrowserPref(engine);
    res.json({ success: true, engine: match.key, name: match.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch AI browser engine
router.post('/browser/ai', (req, res) => {
  try {
    const { engine } = req.body;
    const engines = getEngineList();
    const match = engines.find(e => e.key === engine);
    if (!match) return res.status(400).json({ error: `Invalid engine: ${engine}` });
    if (match.aiBlocked) return res.status(400).json({ error: `${match.name} is currently blocked for AI automated sessions.` });

    saveAiBrowserPref(engine);
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

// Import session from Base64 or JSON
router.post('/sessions/import', (req, res) => {
  try {
    const { provider, sessionData, sessionJson } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider is required' });

    const item = MENU.find(p => p.key === provider.toLowerCase());
    if (!item) return res.status(400).json({ error: `Invalid provider: ${provider}` });

    let parsed = null;
    if (sessionJson && typeof sessionJson === 'object') {
      parsed = sessionJson;
    } else if (sessionData && typeof sessionData === 'string') {
      const trimmed = sessionData.trim();
      if (trimmed.startsWith('{')) {
        parsed = JSON.parse(trimmed);
      } else {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
        parsed = JSON.parse(decoded);
      }
    } else {
      return res.status(400).json({ error: 'sessionData (Base64 or JSON string) or sessionJson (object) is required' });
    }

    if (!parsed || (typeof parsed !== 'object') || (!Array.isArray(parsed.cookies) && !Array.isArray(parsed.origins))) {
      return res.status(400).json({ error: 'Invalid session format. Must contain "cookies" or "origins" array (Playwright storageState).' });
    }

    const sFile = sessionFile(item.key);
    const dir = path.dirname(sFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(sFile, JSON.stringify(parsed, null, 2), 'utf8');
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ provider: item.key }, null, 2));

    res.json({
      success: true,
      message: `Successfully imported and activated session for ${item.label}`,
      provider: item.key,
      cookiesCount: (parsed.cookies || []).length
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to import session: ${err.message}` });
  }
});

// Export all existing sessions as Base64 strings & metadata
router.get('/sessions/export', (req, res) => {
  try {
    const exported = {};
    for (const item of MENU) {
      const sFile = sessionFile(item.key);
      if (fs.existsSync(sFile)) {
        try {
          const raw = fs.readFileSync(sFile, 'utf8');
          const parsed = JSON.parse(raw);
          const cleanedOrigins = (parsed.origins || []).map(entry => ({
            ...entry,
            localStorage: (entry.localStorage || []).filter(i => {
              const name = String(i.name || '');
              return !name.includes('cache/') && !name.includes('history') && !name.includes('conversation') && !name.includes('statsig');
            })
          }));
          const minified = JSON.stringify({ cookies: parsed.cookies || [], origins: cleanedOrigins });
          const b64 = Buffer.from(minified).toString('base64');
          exported[item.key] = {
            provider: item.key,
            label: item.label,
            envVar: `SESSION_${item.key.toUpperCase()}_BASE64`,
            base64: b64,
            cookiesCount: (parsed.cookies || []).length,
            fileSize: raw.length
          };
        } catch (e) {
          // ignore corrupted single file
        }
      }
    }
    res.json({ success: true, sessions: exported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete / logout a session
router.delete('/sessions/:provider', (req, res) => {
  try {
    const provider = req.params.provider?.toLowerCase();
    const item = MENU.find(p => p.key === provider);
    if (!item) return res.status(400).json({ error: `Invalid provider: ${provider}` });

    const sFile = sessionFile(item.key);
    if (fs.existsSync(sFile)) {
      fs.unlinkSync(sFile);
    }
    res.json({ success: true, message: `Session removed for ${item.label}`, provider: item.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Environment info (Docker, proxy, display)
router.get('/environment', (req, res) => {
  const isDocker = fs.existsSync('/.dockerenv') || process.env.IS_DOCKER === 'true';
  const hasDisplay = !!process.env.DISPLAY;
  const proxyServer = process.env.PROXY_SERVER || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || null;
  const vncPort = process.env.VNC_PORT || 6080;
  const enableVnc = process.env.ENABLE_VNC === 'true' || isDocker;

  res.json({
    isDocker,
    hasDisplay,
    display: process.env.DISPLAY || null,
    hasProxy: !!proxyServer,
    proxyConfigured: proxyServer ? proxyServer.replace(/:[^:@]+@/, ':****@') : null,
    enableVnc,
    vncPort: enableVnc ? vncPort : null,
    vncPath: '/novnc/vnc.html?autoconnect=true&resize=remote'
  });
});

export default router;
