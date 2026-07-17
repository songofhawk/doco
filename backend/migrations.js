const migrations = [
  {
    version: 1,
    name: 'baseline',
    up: `
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
      CREATE INDEX IF NOT EXISTS idx_knowledge_bases_workspace_id ON knowledge_bases(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_folders_kb_id ON folders(kb_id);
      CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
      CREATE INDEX IF NOT EXISTS idx_documents_kb_id ON documents(kb_id);
      CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);
    `,
  },
  {
    version: 2,
    name: 'open_api_v1',
    up: `
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
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);

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
      CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at);

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
      CREATE INDEX IF NOT EXISTS idx_api_audit_created_at ON api_audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_attachments_doc_id ON attachments(doc_id);
    `,
  },
  {
    version: 3,
    name: 'email_login_and_auth_identities',
    foreignKeysOff: true,
    up: `
      CREATE TABLE users_v3 (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        normalized_email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email_verified_at INTEGER NOT NULL,
        name TEXT,
        avatar_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO users_v3 (
        id, email, normalized_email, email_verified_at, name, avatar_url, created_at, updated_at
      )
      SELECT id, email, lower(trim(email)), updated_at, name, avatar_url, created_at, updated_at
      FROM users;

      CREATE TABLE auth_identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL,
        email TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, subject),
        UNIQUE (user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO auth_identities (provider, subject, user_id, email, created_at, updated_at)
      SELECT 'google', google_sub, id, email, created_at, updated_at FROM users;

      DROP TABLE users;
      ALTER TABLE users_v3 RENAME TO users;

      CREATE TABLE email_login_codes (
        id TEXT PRIMARY KEY,
        normalized_email TEXT NOT NULL COLLATE NOCASE,
        code_hash TEXT NOT NULL,
        code_salt TEXT NOT NULL,
        requester_ip_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_auth_identities_user_id ON auth_identities(user_id);
      CREATE INDEX idx_email_login_codes_email_created
        ON email_login_codes(normalized_email, created_at DESC);
      CREATE INDEX idx_email_login_codes_ip_created
        ON email_login_codes(requester_ip_hash, created_at DESC);
      CREATE INDEX idx_email_login_codes_expires_at ON email_login_codes(expires_at);
    `,
  },
  {
    version: 4,
    name: 'document_types',
    up: `
      ALTER TABLE documents ADD COLUMN document_type TEXT NOT NULL DEFAULT 'document'
        CHECK (document_type IN ('document', 'spreadsheet'));
      CREATE INDEX idx_documents_document_type ON documents(document_type);
    `,
  },
  {
    version: 5,
    name: 'user_appearance_theme',
    up: `
      ALTER TABLE users ADD COLUMN appearance_theme TEXT NOT NULL DEFAULT 'simple'
        CHECK (appearance_theme IN ('simple', 'paper'));
    `,
  },
  {
    version: 6,
    name: 'resource_creators_and_timestamps',
    up: `
      ALTER TABLE knowledge_bases ADD COLUMN created_by_user_id TEXT
        REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE knowledge_bases ADD COLUMN created_at INTEGER;
      ALTER TABLE knowledge_bases ADD COLUMN updated_at INTEGER;

      ALTER TABLE folders ADD COLUMN created_by_user_id TEXT
        REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE folders ADD COLUMN created_at INTEGER;
      ALTER TABLE folders ADD COLUMN updated_at INTEGER;

      ALTER TABLE documents ADD COLUMN created_by_user_id TEXT
        REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE documents ADD COLUMN created_at INTEGER;
      ALTER TABLE documents ADD COLUMN updated_at INTEGER;

      UPDATE knowledge_bases
      SET created_by_user_id = (
        SELECT w.owner_user_id FROM workspaces w WHERE w.id = knowledge_bases.workspace_id
      )
      WHERE created_by_user_id IS NULL;

      UPDATE folders
      SET created_by_user_id = (
        SELECT w.owner_user_id
        FROM knowledge_bases kb
        JOIN workspaces w ON w.id = kb.workspace_id
        WHERE kb.id = folders.kb_id
      )
      WHERE created_by_user_id IS NULL;

      UPDATE documents
      SET created_by_user_id = (
        SELECT w.owner_user_id
        FROM knowledge_bases kb
        JOIN workspaces w ON w.id = kb.workspace_id
        WHERE kb.id = COALESCE(
          documents.kb_id,
          (SELECT f.kb_id FROM folders f WHERE f.id = documents.folder_id)
        )
      )
      WHERE created_by_user_id IS NULL;

      CREATE INDEX idx_knowledge_bases_created_by ON knowledge_bases(created_by_user_id);
      CREATE INDEX idx_folders_created_by ON folders(created_by_user_id);
      CREATE INDEX idx_documents_created_by ON documents(created_by_user_id);
    `,
  },
];

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_bases'").get()
      && !columnExists(db, 'knowledge_bases', 'workspace_id')) {
    db.exec('ALTER TABLE knowledge_bases ADD COLUMN workspace_id TEXT');
  }

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const existingViolations = migration.foreignKeysOff
      ? new Set(db.pragma('foreign_key_check').map((row) => JSON.stringify(row)))
      : new Set();
    const apply = db.transaction(() => {
      db.exec(migration.up);
      if (migration.foreignKeysOff) {
        const newViolations = db.pragma('foreign_key_check')
          .filter((row) => !existingViolations.has(JSON.stringify(row)));
        if (newViolations.length > 0) {
          throw new Error(`Migration ${migration.version} introduced foreign key violations`);
        }
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now());
    });

    if (!migration.foreignKeysOff) {
      apply();
      continue;
    }

    db.pragma('foreign_keys = OFF');
    try {
      apply();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

export { migrations };
