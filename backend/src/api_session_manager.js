import { openAiSession } from './ai.js';
import { PROVIDERS } from './providers/index.js';

// Map of active API sessions: sessionId -> { browser, page, providerName, providerKey, createdAt, lastUsed, timeoutTimer }
const activeApiSessions = new Map();

// Default idle timeout: 15 minutes
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Normalizes model names/aliases to valid provider keys.
 */
export function resolveProviderKey(modelName) {
  if (!modelName || modelName === 'default' || modelName === 'auto') {
    return null; // fallback to active provider in ai.js
  }

  const name = String(modelName).toLowerCase().trim();

  if (name.includes('chatgpt') || name.includes('gpt')) return 'chatgpt';
  if (name.includes('grok')) return 'grok';
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('perplexity') || name.includes('sonar')) return 'perplexity';
  if (name.includes('deepseek')) return 'deepseek';

  if (PROVIDERS[name]) return name;

  return null;
}

/**
 * Safe browser connection check helper
 */
export function isSessionConnected(session) {
  if (!session) return false;
  try {
    if (typeof session.browser?.isConnected === 'function') {
      return session.browser.isConnected();
    }
    if (typeof session.browser?.browser === 'function' && typeof session.browser.browser()?.isConnected === 'function') {
      return session.browser.browser().isConnected();
    }
    if (session.page && typeof session.page.isClosed === 'function' && !session.page.isClosed()) {
      return true;
    }
    return Boolean(session.isConnected || session.active || (session.browser && typeof session.browser.close === 'function'));
  } catch (e) {
    return false;
  }
}

/**
 * Gets an existing session or creates a new browser session.
 */
export async function getOrCreateSession({ sessionId = null, model = null } = {}) {
  const providerKey = resolveProviderKey(model);

  // If a valid session ID was provided and exists
  if (sessionId && activeApiSessions.has(sessionId)) {
    const session = activeApiSessions.get(sessionId);
    
    // Check if browser context is still connected
    if (isSessionConnected(session)) {
      session.lastUsed = Date.now();
      resetSessionTimer(sessionId);
      return { session, createdNew: false };
    } else {
      // Browser crashed or was closed out-of-band
      activeApiSessions.delete(sessionId);
    }
  }

  // Create new session
  const options = providerKey ? { provider: providerKey } : {};
  const { browser, page, providerName, providerKey: actualProviderKey } = await openAiSession(false, options);

  const newSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  const sessionData = {
    id: newSessionId,
    browser,
    page,
    providerName,
    providerKey: actualProviderKey,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    timeoutTimer: null
  };

  activeApiSessions.set(newSessionId, sessionData);
  resetSessionTimer(newSessionId);

  return { session: sessionData, createdNew: true };
}

/**
 * Resets or sets the idle timeout timer for a session.
 */
function resetSessionTimer(sessionId) {
  const session = activeApiSessions.get(sessionId);
  if (!session) return;

  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
  }

  session.timeoutTimer = setTimeout(async () => {
    console.log(`[API Session Manager] Session ${sessionId} idle timeout reached. Closing browser.`);
    await closeSession(sessionId);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Closes an active API session.
 */
export async function closeSession(sessionId) {
  const session = activeApiSessions.get(sessionId);
  if (!session) return false;

  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
  }

  try {
    if (isSessionConnected(session)) {
      if (typeof session.browser?.close === 'function') {
        await session.browser.close().catch(() => {});
      } else if (typeof session.page?.close === 'function') {
        await session.page.close().catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[API Session Manager] Error closing browser for ${sessionId}:`, err.message);
  }

  activeApiSessions.delete(sessionId);
  return true;
}

/**
 * Lists all active API sessions.
 */
export function listSessions() {
  const list = [];
  for (const [id, s] of activeApiSessions.entries()) {
    list.push({
      id,
      providerName: s.providerName,
      providerKey: s.providerKey,
      createdAt: new Date(s.createdAt).toISOString(),
      lastUsed: new Date(s.lastUsed).toISOString(),
      isConnected: isSessionConnected(s)
    });
  }
  return list;
}

/**
 * Closes all active sessions.
 */
export async function closeAllSessions() {
  const ids = Array.from(activeApiSessions.keys());
  for (const id of ids) {
    await closeSession(id);
  }
}
