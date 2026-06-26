import { Router } from 'express';

const router = Router();
const chatSessions = new Map();

router.post('/chat/start', async (req, res) => {
  try {
    const { openAiSession } = await import('../src/ai.js');
    const { browser, page, providerName } = await openAiSession(false);
    const sessionId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    chatSessions.set(sessionId, { browser, page, providerName });
    console.log(`  ✓ Chat session started: ${sessionId} (${providerName})`);
    res.json({ success: true, sessionId, provider: providerName });
  } catch (err) {
    console.error(`  ✗ Chat session start failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat/send', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message are required' });

    const session = chatSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Chat session not found. Call /api/chat/start first.' });

    const { sendMessage } = await import('../src/ai.js');
    const io = req.app.get('io');
    io.emit('chat:thinking', { sessionId });

    const response = await sendMessage(session.page, message);
    io.emit('chat:response', { sessionId, message: response, provider: session.providerName });

    res.json({ response, provider: session.providerName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat/close', async (req, res) => {
  try {
    const { sessionId } = req.body;
    console.log(`  ✗ Closing chat session: ${sessionId}`);
    const session = chatSessions.get(sessionId);
    if (session) {
      await session.browser.close().catch((e) => console.error(`  ✗ Failed to close browser:`, e.message));
      chatSessions.delete(sessionId);
      console.log(`  ✓ Browser closed for session: ${sessionId}`);
    } else {
      console.log(`  ⚠ Session not found or already closed: ${sessionId}`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`  ✗ Chat session close failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
