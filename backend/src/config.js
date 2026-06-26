import path from 'path';
import { fileURLToPath } from 'url';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

export const DATA_DIR          = path.join(__dirname, '..', 'data');
export const SESSION_DIR       = path.join(__dirname, '..', 'session');
export const DOMAIN_SKILLS_DIR = path.join(__dirname, '..', 'domain-skills');
export const SUBAGENT_RUNS_DIR = path.join(__dirname, '..', 'subagent_runs');

export const BROWSER_PROFILES_DIR = path.join(DATA_DIR, 'browser-profiles');
export const PROFILE_FILE      = path.join(DATA_DIR, 'profile.json');
export const PERMISSIONS_FILE  = path.join(DATA_DIR, 'permissions.json');
export const ACTIVE_FILE       = path.join(SESSION_DIR, 'active.json');
export const LEDGER_DB_FILE    = path.join(DATA_DIR, 'applications.sqlite');

// Returns session file path for a given provider key.
// chatgpt keeps the legacy filename (session.json) so existing sessions still work.
export const sessionFile = (key) =>
  path.join(SESSION_DIR, key === 'chatgpt' ? 'session.json' : `${key}.json`);

// Legacy alias — kept so any direct SESSION_FILE import still compiles.
export const SESSION_FILE = sessionFile('chatgpt');
