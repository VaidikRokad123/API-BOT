import { Router } from 'express';

const router = Router();

router.get('/history', async (req, res) => {
  try {
    const { Application } = await import('../src/apply/ledger.js');
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const verdict = req.query.verdict || null;

    const filter = {};
    if (verdict) filter.verdict = verdict;

    const rows = await Application.find(filter)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit);

    const count = await Application.countDocuments(filter);
    res.json({ applications: rows, total: count, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/stats', async (req, res) => {
  try {
    const { Application } = await import('../src/apply/ledger.js');
    
    const total = await Application.countDocuments({});
    const success = await Application.countDocuments({ verdict: 'success' });
    const failure = await Application.countDocuments({ verdict: 'failure' });

    const byReason = await Application.aggregate([
      { $match: { verdict: 'failure' } },
      { $group: { _id: '$failure_reason', count: { $sum: 1 } } }
    ]);
    const failureReasons = byReason.map(r => ({ failure_reason: r._id, count: r.count }));

    const recent = await Application.find({})
      .sort({ timestamp: -1 })
      .limit(5);

    res.json({
      total,
      success,
      failure,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      failureReasons,
      recent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
