import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DOCO_DB_PATH || join(__dirname, 'doco.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kb_id INTEGER NOT NULL,
    parent_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    folder_id INTEGER,
    kb_id INTEGER,
    heading_numbered INTEGER DEFAULT 0,
    bg_color TEXT DEFAULT '#ffffff',
    collapsed_blocks TEXT DEFAULT ''
  );

  -- 每文档一行合并快照（替代无限增长的 ydoc_updates 增量表）
  CREATE TABLE IF NOT EXISTS ydoc_state (
    doc_id TEXT PRIMARY KEY,
    state BLOB NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    doc_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 旧版增量表（sql.js 时代）可能仍存在，用于懒迁移
export const hasLegacyUpdatesTable = !!db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ydoc_updates'")
  .get();
