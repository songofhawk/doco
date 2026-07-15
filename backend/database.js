import './env.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from './migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export function createDatabase(path = process.env.DOCO_DB_PATH || join(__dirname, 'doco.db')) {
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

export const db = createDatabase();

// 旧版增量表（sql.js 时代）可能仍存在，用于懒迁移
export const hasLegacyUpdatesTable = !!db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ydoc_updates'")
  .get();
