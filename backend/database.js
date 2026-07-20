import './env.js';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { basename, dirname, join, resolve } from 'path';
import { runMigrations } from './migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function rebaseAttachmentPaths(database, directory = process.env.DOCO_ATTACHMENTS_PATH || join(__dirname, 'attachments')) {
  const attachmentDir = resolve(directory);
  const rows = database.prepare('SELECT id, filepath FROM attachments').all();
  const update = database.prepare('UPDATE attachments SET filepath = ? WHERE id = ?');
  let rebased = 0;

  const apply = database.transaction(() => {
    for (const row of rows) {
      if (existsSync(row.filepath)) continue;
      const candidate = join(attachmentDir, basename(row.filepath));
      if (!existsSync(candidate)) continue;
      update.run(candidate, row.id);
      rebased += 1;
    }
  });

  apply();
  return rebased;
}

export function createDatabase(path = process.env.DOCO_DB_PATH || join(__dirname, 'doco.db')) {
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  const rebased = rebaseAttachmentPaths(database);
  if (rebased > 0) console.log(`[Database] Rebased ${rebased} attachment path(s)`);
  return database;
}

export const db = createDatabase();

// 旧版增量表（sql.js 时代）可能仍存在，用于懒迁移
export const hasLegacyUpdatesTable = !!db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ydoc_updates'")
  .get();
