import { Router } from 'express';
import fs from 'fs';
import { readActiveKey, sendMessage } from '../src/ai.js';
import { PROVIDERS } from '../src/providers/index.js';
import { ACTIVE_FILE, sessionFile } from '../src/config.js';
import {
  getOrCreateSession,
  closeSession,
  listSessions,
  resolveProviderKey
} from '../src/api_session_manager.js';

const router = Router();

// Optional API key validation middleware
function authMiddleware(req, res, next) {
  const apiKey = process.env.LLM_API_KEY || process.env.API_KEY;
  if (!apiKey) return next(); // No key configured = public local API

  const reqKey = req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);
  if (reqKey !== apiKey) {
    return res.status(401).json({
      error: {
        message: 'Incorrect or missing API key provided.',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key'
      }
    });
  }
  next();
}

router.use(authMiddleware);

// Helper to format messages array into single prompt string
function formatMessagesToPrompt(messages) {
  if (typeof messages === 'string') return messages;
  if (!Array.isArray(messages) || messages.length === 0) return '';

  if (messages.length === 1 && messages[0].role === 'user') {
    return messages[0].content;
  }

  let promptParts = [];
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    promptParts.push(`[System Instruction]\n${systemMsg.content}\n`);
  }

  const nonSystemMsgs = messages.filter(m => m.role !== 'system');
  if (nonSystemMsgs.length > 0) {
    promptParts.push('[Conversation]');
    for (const msg of nonSystemMsgs) {
      const roleName = msg.role === 'user' ? 'User' : (msg.role === 'assistant' ? 'Assistant' : msg.role);
      promptParts.push(`${roleName}: ${msg.content}`);
    }
  }

  return promptParts.join('\n\n');
}

// ─── GET /v1/models & /api/v1/models ─────────────────────────────────────────
const getModelsHandler = (req, res) => {
  const activeKey = readActiveKey();
  const modelsData = Object.keys(PROVIDERS).map(key => {
    const p = PROVIDERS[key];
    const sFile = sessionFile(key);
    const isLoggedIn = fs.existsSync(sFile);
    
    return {
      id: key,
      object: 'model',
      created: 1700000000,
      owned_by: key === 'chatgpt' ? 'openai' : (key === 'grok' ? 'xai' : (key === 'gemini' ? 'google' : key)),
      permission: [],
      root: key,
      parent: null,
      meta: {
        name: p.config.name,
        url: p.config.url,
        loggedIn: isLoggedIn,
        active: key === activeKey
      }
    };
  });

  res.json({
    object: 'list',
    data: modelsData
  });
};

router.get('/v1/models', getModelsHandler);
router.get('/api/v1/models', getModelsHandler);

// ─── POST /v1/chat/completions & /api/v1/chat/completions ───────────────────
const chatCompletionsHandler = async (req, res) => {
  let createdSessionId = null;
  let keepSessionAlive = false;

  try {
    const {
      model,
      messages,
      prompt, // fallback for legacy clients
      stream = false,
      session_id,
      sessionId: altSessionId,
      keep_alive
    } = req.body;

    const requestedSessionId = session_id || altSessionId;
    if (requestedSessionId || keep_alive === true) {
      keepSessionAlive = true;
    }

    const rawInput = messages || prompt;
    if (!rawInput) {
      return res.status(400).json({
        error: {
          message: 'Field "messages" (array) or "prompt" (string) is required.',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_required_field'
        }
      });
    }

    // Get or create session
    const { session, createdNew } = await getOrCreateSession({
      sessionId: requestedSessionId,
      model
    });

    createdSessionId = session.id;

    // Determine prompt to send
    let promptText = '';
    if (Array.isArray(messages) && messages.length > 0) {
      if (!createdNew && requestedSessionId) {
        // Multi-turn in active browser tab: send only the newest user message
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        promptText = lastUserMsg ? lastUserMsg.content : formatMessagesToPrompt(messages);
      } else {
        promptText = formatMessagesToPrompt(messages);
      }
    } else {
      promptText = String(rawInput);
    }

    // Send prompt to AI provider browser page
    const answerText = await sendMessage(session.page, promptText, session.providerKey);
    const createdTimestamp = Math.floor(Date.now() / 1000);
    const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil(answerText.length / 4);

    if (stream) {
      // Return OpenAI-compatible SSE Stream
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const chunkRole = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: createdTimestamp,
        model: session.providerKey,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant' },
            finish_reason: null
          }
        ]
      };
      res.write(`data: ${JSON.stringify(chunkRole)}\n\n`);

      const chunkContent = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: createdTimestamp,
        model: session.providerKey,
        choices: [
          {
            index: 0,
            delta: { content: answerText },
            finish_reason: null
          }
        ]
      };
      res.write(`data: ${JSON.stringify(chunkContent)}\n\n`);

      const chunkEnd = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: createdTimestamp,
        model: session.providerKey,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ]
      };
      res.write(`data: ${JSON.stringify(chunkEnd)}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Return OpenAI-compatible JSON response
    res.json({
      id: completionId,
      object: 'chat.completion',
      created: createdTimestamp,
      model: session.providerKey,
      system_fingerprint: `local-${session.providerKey}`,
      session_id: session.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: answerText
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    });

  } catch (err) {
    console.error('  ✗ LLM API Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: err.message,
          type: 'api_error',
          param: null,
          code: 'internal_error'
        }
      });
    }
  } finally {
    // If one-shot request without persistent session request, close session to free resources
    if (createdSessionId && !keepSessionAlive) {
      closeSession(createdSessionId).catch(() => {});
    }
  }
};

router.post('/v1/chat/completions', chatCompletionsHandler);
router.post('/api/v1/chat/completions', chatCompletionsHandler);

// ─── POST /v1/completions & /api/v1/completions ─────────────────────────────
const completionsHandler = async (req, res) => {
  const { prompt, model, stream, session_id } = req.body;
  req.body.messages = [{ role: 'user', content: prompt || '' }];
  return chatCompletionsHandler(req, res);
};

router.post('/v1/completions', completionsHandler);
router.post('/api/v1/completions', completionsHandler);

// ─── POST /api/v1/generate ──────────────────────────────────────────────────
// Simple REST endpoint returning clean JSON
router.post('/api/v1/generate', async (req, res) => {
  let createdSessionId = null;
  let keepAlive = req.body.keep_alive || req.body.session_id;

  try {
    const { prompt, provider, model, session_id } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });

    const targetModel = provider || model;
    const { session } = await getOrCreateSession({
      sessionId: session_id,
      model: targetModel
    });

    createdSessionId = session.id;
    const responseText = await sendMessage(session.page, prompt, session.providerKey);

    res.json({
      success: true,
      provider: session.providerName,
      providerKey: session.providerKey,
      sessionId: session.id,
      prompt,
      response: responseText,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (createdSessionId && !keepAlive) {
      closeSession(createdSessionId).catch(() => {});
    }
  }
});

// ─── GET /api/v1/sessions & DELETE /api/v1/sessions/:id ─────────────────────
router.get('/api/v1/sessions', (req, res) => {
  res.json({ success: true, sessions: listSessions() });
});

router.delete('/api/v1/sessions/:id', async (req, res) => {
  const closed = await closeSession(req.params.id);
  res.json({ success: closed, sessionId: req.params.id });
});

export default router;
