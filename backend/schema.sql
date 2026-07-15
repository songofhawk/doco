-- Doco 后端 SQLite 结构参考。
-- 实际升级以 migrations.js 中的版本化 migration 为准，禁止直接把本文件当作迁移脚本执行。

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  token_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, method, path, idempotency_key),
  FOREIGN KEY (token_id) REFERENCES api_tokens(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  user_id TEXT,
  token_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  request_id TEXT,
  ip TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_workspace_id ON knowledge_bases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_folders_kb_id ON folders(kb_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_kb_id ON documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_api_audit_created_at ON api_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_doc_id ON attachments(doc_id);

-- 旧版增量表 ydoc_updates 已废弃：由 migrate.js 一次性合并，
-- 或由 server.js 在文档首次加载时懒迁移；确认数据无误后可 DROP。
