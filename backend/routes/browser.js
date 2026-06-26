import { Router } from 'express';

const router = Router();

router.post('/browser/task', async (req, res) => {
  try {
    const { task, engine, aiEngine, hidden } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });

    const io = req.app.get('io');
    io.emit('browser:start', { task });

    const { readBrowserPref, readAiBrowserPref } = await import('../src/browser.js');
    const { runBrowserSubagent } = await import('../src/subagent/index.js');
    const result = await runBrowserSubagent(task, {
      engine: engine || readBrowserPref(),
      aiEngine: aiEngine || req.body.provider || readAiBrowserPref(),
      hidden: hidden || false
    });

    io.emit('browser:done', { task, verdict: result?.verdict, runId: result?.runId, report: result?.report });
    res.json({ success: true, verdict: result?.verdict, runId: result?.runId, report: result?.report, artifactsDir: result?.artifactsDir });
  } catch (err) {
    const io = req.app.get('io');
    io.emit('browser:error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
