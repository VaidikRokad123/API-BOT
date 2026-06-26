import { Router } from 'express';

const router = Router();

router.post('/apply', async (req, res) => {
  const { url, engine, aiEngine, doResearch } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const io = req.app.get('io');
  io.emit('apply:start', { url });

  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => {
    const text = String(chunk).trim();
    if (text) io.emit('apply:log', { message: text });
    return origWrite(chunk, ...args);
  };

  try {
    const { readBrowserPref, readAiBrowserPref } = await import('../src/browser.js');
    const { apply } = await import('../src/apply/index.js');
    const result = await apply(url, true, {
      browserEngine: engine || readBrowserPref(),
      aiEngine: aiEngine || readAiBrowserPref(),
      doResearch: doResearch !== false
    });

    io.emit('apply:done', { url, verdict: result?.verdict, runId: result?.runId, research: result?.research });
    res.json({ success: true, verdict: result?.verdict, runId: result?.runId, research: result?.research, skipped: result?.skipped || false });
  } catch (err) {
    io.emit('apply:error', { error: err.message });
    res.status(500).json({ error: err.message });
  } finally {
    process.stdout.write = origWrite;
  }
});

export default router;
