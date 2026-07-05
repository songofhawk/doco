-- Doco 后端 SQLite 结构（better-sqlite3，由 database.js 启动时自动创建）

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

-- 每文档一行合并快照（Yjs 完整状态，UPSERT 更新，不再无限增长）
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

-- 旧版增量表 ydoc_updates 已废弃：由 migrate.js 一次性合并，
-- 或由 server.js 在文档首次加载时懒迁移；确认数据无误后可 DROP。
