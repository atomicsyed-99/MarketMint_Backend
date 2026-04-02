import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'swipefile.db');

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sha256          TEXT NOT NULL UNIQUE,
    filename        TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    media_type      TEXT NOT NULL DEFAULT 'image',
    thumbnail_path  TEXT,
    duration_secs   REAL,
    brand           TEXT DEFAULT '',
    platform        TEXT DEFAULT '',
    format          TEXT DEFAULT '',
    hook_angle      TEXT DEFAULT '',
    cta             TEXT DEFAULT '',
    campaign        TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    ai_analysis     TEXT DEFAULT '',
    embedding_visual  TEXT,
    embedding_text    TEXT,
    indexed         INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ads_sha256 ON ads(sha256);
CREATE INDEX IF NOT EXISTS idx_ads_platform ON ads(platform);
CREATE INDEX IF NOT EXISTS idx_ads_format ON ads(format);
CREATE INDEX IF NOT EXISTS idx_ads_hook_angle ON ads(hook_angle);
CREATE INDEX IF NOT EXISTS idx_ads_cta ON ads(cta);
CREATE INDEX IF NOT EXISTS idx_ads_indexed ON ads(indexed);
`;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
  }
  return db;
}
