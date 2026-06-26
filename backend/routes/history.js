import { Router } from 'express';

const router = Router();

router.get('/history', async (req, res) => {
  try {
    const { openApplicationLedger } = await import('../src/apply/ledger.js');
    const db = await openApplicationLedger();
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const verdict = req.query.verdict || null;

      let query = 'SELECT * FROM applications';
      const params = [];
      if (verdict) { query += ' WHERE verdict = ?'; params.push(verdict); }
      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      const total = db.prepare(verdict ? 'SELECT COUNT(*) as count FROM applications WHERE verdict = ?' : 'SELECT COUNT(*) as count FROM applications').get(...(verdict ? [verdict] : []));
      res.json({ applications: rows, total: total.count, limit, offset });
    } finally { db.close(); }
  } catch (err) {
    if (err.message?.includes('node:sqlite')) return res.json({ applications: [], total: 0, warning: 'SQLite not available (Node 22.5+)' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/stats', async (req, res) => {
  try {
    const { openApplicationLedger } = await import('../src/apply/ledger.js');
    const db = await openApplicationLedger();
    try {
      const total = db.prepare('SELECT COUNT(*) as count FROM applications').get();
      const success = db.prepare('SELECT COUNT(*) as count FROM applications WHERE verdict = ?').get('success');
      const failure = db.prepare('SELECT COUNT(*) as count FROM applications WHERE verdict = ?').get('failure');
      const byReason = db.prepare('SELECT failure_reason, COUNT(*) as count FROM applications WHERE verdict = ? GROUP BY failure_reason').all('failure');
      const recent = db.prepare('SELECT url, company, role, verdict, failure_reason, timestamp FROM applications ORDER BY timestamp DESC LIMIT 5').all();
      res.json({ total: total.count, success: success.count, failure: failure.count, successRate: total.count > 0 ? Math.round((success.count / total.count) * 100) : 0, failureReasons: byReason, recent });
    } finally { db.close(); }
  } catch (err) {
    if (err.message?.includes('node:sqlite')) return res.json({ total: 0, success: 0, failure: 0, successRate: 0, failureReasons: [], recent: [] });
    res.status(500).json({ error: err.message });
  }
});

export default router;
