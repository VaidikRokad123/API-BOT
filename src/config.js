import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const SESSION_FILE = path.join(__dirname, '..', 'session', 'session.json');
export const PROFILE_FILE = path.join(__dirname, '..', 'data', 'profile.json');
