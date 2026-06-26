import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'applications.sqlite');

let sqliteModPromise = null;

async function loadSqlite() {
  if (!sqliteModPromise) {
    sqliteModPromise = import('node:sqlite').catch(() => null);
  }
  return sqliteModPromise;
}

export async function openApplicationLedger() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = await loadSqlite();
  if (!sqlite?.DatabaseSync) {
    throw new Error('node:sqlite is not available in this Node runtime; use Node 22.5+ or 24+.');
  }
  const db = new sqlite.DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT,
      company TEXT,
      role TEXT,
      verdict TEXT NOT NULL,
      failure_reason TEXT,
      run_id TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_applications_url ON applications(url);
    CREATE INDEX IF NOT EXISTS idx_applications_company_role ON applications(company, role);
  `);
  return db;
}

export async function findSuccessfulApplication({ url, company, role } = {}) {
  const db = await openApplicationLedger();
  try {
    if (url) {
      const row = db.prepare('SELECT * FROM applications WHERE url = ? AND verdict = ? ORDER BY timestamp DESC LIMIT 1').get(url, 'success');
      if (row) return row;
    }
    if (company && role) {
      return db.prepare(
        'SELECT * FROM applications WHERE lower(company) = lower(?) AND lower(role) = lower(?) AND verdict = ? ORDER BY timestamp DESC LIMIT 1'
      ).get(company, role, 'success') || null;
    }
    return null;
  } finally {
    db.close();
  }
}

export async function recordApplicationVerdict({ url, company, role, verdict, failure_reason, run_id }) {
  const db = await openApplicationLedger();
  try {
    db.prepare(`
      INSERT INTO applications (url, company, role, verdict, failure_reason, run_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      url || null,
      company || null,
      role || null,
      verdict || 'failure',
      failure_reason || null,
      run_id || null,
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}
