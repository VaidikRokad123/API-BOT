import { Router } from 'express';
import { searchAndMatchJobs, getDiscoveredJobs, getCandidateProfile } from '../src/job_finder.js';

const router = Router();

// ─── POST /api/jobs/search ──────────────────────────────────────────────────
router.post('/jobs/search', async (req, res) => {
  try {
    const { role, location, minCtc, minExp, maxExp, query, limit } = req.body;
    const results = await searchAndMatchJobs({
      role,
      location,
      minCtc,
      minExp,
      maxExp,
      query,
      limit: limit ? Number(limit) : 10
    });

    res.json({
      success: true,
      count: results.length,
      jobs: results
    });
  } catch (err) {
    console.error('  ✗ Job Search Route Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/jobs/discovered ───────────────────────────────────────────────
router.get('/jobs/discovered', (req, res) => {
  try {
    const jobs = getDiscoveredJobs();
    res.json({
      success: true,
      count: jobs.length,
      jobs
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/jobs/profile ──────────────────────────────────────────────────
router.get('/jobs/profile', (req, res) => {
  try {
    const profile = getCandidateProfile();
    res.json({
      success: true,
      profile: {
        name: profile.name,
        currentRole: profile.currentRole,
        desiredRole: profile.desiredRole,
        location: profile.location,
        yearsOfExperience: profile.yearsOfExperience,
        expectedCTC: profile.expectedCTC,
        skills: profile.skills || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/jobs/apply ───────────────────────────────────────────────────
router.post('/jobs/apply', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    const { startApplyFlow } = await import('../src/apply/index.js');
    const io = req.app.get('io');
    
    // Trigger application flow asynchronously
    startApplyFlow(url, { io, realBrowser: false })
      .then((result) => console.log(`  ✓ Auto-apply finished for ${url}:`, result))
      .catch((err) => console.error(`  ✗ Auto-apply failed for ${url}:`, err.message));

    res.json({
      success: true,
      message: `Started auto-application flow for ${url}`,
      url
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
