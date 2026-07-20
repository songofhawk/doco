import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDir = mkdtempSync(join(tmpdir(), 'doco-database-test-'));
const attachmentDir = join(tempDir, 'attachments');
process.env.DOCO_DB_PATH = join(tempDir, 'test.db');
process.env.DOCO_ATTACHMENTS_PATH = attachmentDir;

let db;
let rebaseAttachmentPaths;

before(async () => {
  ({ db, rebaseAttachmentPaths } = await import('../database.js'));
});

after(() => {
  try { db.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
});

test('部署目录变化后仅重定向确实存在的同名附件', () => {
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (id, email, normalized_email, email_verified_at, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('database-user', 'database@example.com', 'database@example.com', now, 'Database', now, now);
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)')
    .run('database-workspace', 'Database', 'database-user', now, now);
  db.prepare('INSERT INTO workspace_members VALUES (?, ?, ?, ?)')
    .run('database-workspace', 'database-user', 'owner', now);
  const kbId = db.prepare('INSERT INTO knowledge_bases (name, workspace_id) VALUES (?, ?)')
    .run('Database', 'database-workspace').lastInsertRowid;
  db.prepare('INSERT INTO documents (id, title, kb_id) VALUES (?, ?, ?)')
    .run('database-doc', 'Database', kbId);

  mkdirSync(attachmentDir, { recursive: true });
  const targetPath = join(attachmentDir, 'portable.png');
  writeFileSync(targetPath, Buffer.from([1, 2, 3]));
  db.prepare('INSERT INTO attachments (id, filename, filepath, mime_type, size, doc_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('portable', 'portable.png', '/old/server/attachments/portable.png', 'image/png', 3, 'database-doc');
  db.prepare('INSERT INTO attachments (id, filename, filepath, mime_type, size, doc_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('missing', 'missing.png', '/old/server/attachments/missing.png', 'image/png', 3, 'database-doc');

  assert.equal(rebaseAttachmentPaths(db, attachmentDir), 1);
  assert.equal(db.prepare('SELECT filepath FROM attachments WHERE id = ?').get('portable').filepath, targetPath);
  assert.equal(db.prepare('SELECT filepath FROM attachments WHERE id = ?').get('missing').filepath, '/old/server/attachments/missing.png');
});
