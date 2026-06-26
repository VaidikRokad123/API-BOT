import { Router } from 'express';
import fs from 'fs';
import { ACTIVE_FILE, sessionFile } from '../src/config.js';
import { readBrowserPref, readAiBrowserPref, getEngineList } from '../src/browser.js';

const router = Router();

router.get('/status', (req, res) => {
  try {
    let provider = null;
    let hasSession = false;
    try {
      const active = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
      provider = active.provider;
      hasSession = fs.existsSync(sessionFile(provider));
    } catch { /* no active provider */ }

    const browserPref = readBrowserPref();
    const aiBrowserPref = readAiBrowserPref();
    const engines = getEngineList();
    const browserName = engines.find(e => e.key === browserPref)?.name || browserPref;
    const aiBrowserName = engines.find(e => e.key === aiBrowserPref)?.name || aiBrowserPref;

    res.json({
      provider,
      providerLabel: provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : null,
      hasSession,
      browser: browserPref,
      browserName,
      aiBrowser: aiBrowserPref,
      aiBrowserName,
      engines
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
