import { Router } from 'express';
import fs from 'fs';
import { sessionFile } from '../src/config.js';
import { MENU } from '../src/login.js';

const router = Router();

router.post('/council', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    const io = req.app.get('io');
    const loggedIn = MENU.filter(p => fs.existsSync(sessionFile(p.key)));
    if (loggedIn.length < 2) return res.status(400).json({ error: `Council needs at least 2 logged-in providers (found ${loggedIn.length})` });

    io.emit('council:start', { question, providers: loggedIn.map(p => p.label) });

    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      const text = String(chunk).trim();
      if (text) io.emit('council:log', { message: text });
      return origWrite(chunk, ...args);
    };

    const { council } = await import('../src/council.js');
    const readline = (await import('readline')).default;
    const mockRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    mockRl.question = (q, cb) => cb(q.includes('merge') ? '1' : '');

    await council(question, mockRl, false);
    mockRl.close();
    process.stdout.write = origWrite;

    io.emit('council:done', { question });
    res.json({ success: true, providers: loggedIn.map(p => p.label) });
  } catch (err) {
    const io = req.app.get('io');
    io.emit('council:error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
