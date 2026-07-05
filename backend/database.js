import './env.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DOCO_DB_PATH || join(__dirname, 'doco.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    workspace_id TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
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

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_folders_kb_id ON folders(kb_id);
  CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
  CREATE INDEX IF NOT EXISTS idx_documents_kb_id ON documents(kb_id);
  CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);
`);

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

if (!columnExists('knowledge_bases', 'workspace_id')) {
  db.exec('ALTER TABLE knowledge_bases ADD COLUMN workspace_id TEXT');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_bases_workspace_id ON knowledge_bases(workspace_id)');

// 旧版增量表（sql.js 时代）可能仍存在，用于懒迁移
export const hasLegacyUpdatesTable = !!db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ydoc_updates'")
  .get();
