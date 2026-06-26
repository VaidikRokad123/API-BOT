import { Router } from 'express';

const router = Router();

router.post('/browser/task', async (req, res) => {
  try {
    const { task, engine, hidden, provider } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });

    const io = req.app.get('io');
    io.emit('browser:start', { task });

    const { runBrowserSubagent } = await import('../src/subagent/index.js');
    const result = await runBrowserSubagent(task, {
      engine: engine || undefined,
      aiEngine: provider || 'playwright',
      hidden: hidden || false
    });

    io.emit('browser:done', { task, verdict: result?.verdict, runId: result?.runId });
    res.json({ success: true, verdict: result?.verdict, runId: result?.runId, artifactsDir: result?.artifactsDir });
  } catch (err) {
    const io = req.app.get('io');
    io.emit('browser:error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
