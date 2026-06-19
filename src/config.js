import path from 'path';
import { fileURLToPath } from 'url';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const SESSION_DIR  = path.join(__dirname, '..', 'session');

export const PROFILE_FILE = path.join(__dirname, '..', 'data', 'profile.json');
export const ACTIVE_FILE  = path.join(SESSION_DIR, 'active.json');

// Returns session file path for a given provider key.
// chatgpt keeps the legacy filename (session.json) so existing sessions still work.
export const sessionFile = (key) =>
  path.join(SESSION_DIR, key === 'chatgpt' ? 'session.json' : `${key}.json`);

// Legacy alias — kept so any direct SESSION_FILE import still compiles.
export const SESSION_FILE = sessionFile('chatgpt');
