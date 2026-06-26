import { Router } from 'express';

const router = Router();

router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    const { openAiSession, sendMessage } = await import('../src/ai.js');
    const { browser, page, providerName } = await openAiSession(false);
    try {
      const response = await sendMessage(page, question);
      res.json({ answer: response, provider: providerName });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
