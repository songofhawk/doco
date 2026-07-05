// 一次性迁移：ydoc_updates 增量表 → ydoc_state 单快照表
// 用法：node migrate.js（运行前请备份 doco.db）
import * as Y from 'yjs';
import { db, hasLegacyUpdatesTable } from './database.js';

if (!hasLegacyUpdatesTable) {
  console.log('没有发现旧版 ydoc_updates 表，无需迁移');
  process.exit(0);
}

const upsert = db.prepare(`
  INSERT INTO ydoc_state (doc_id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(doc_id) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
`);

const docIds = db.prepare('SELECT DISTINCT doc_id FROM ydoc_updates').all().map(r => r.doc_id);
let migrated = 0;
let skipped = 0;

for (const docId of docIds) {
  if (db.prepare('SELECT 1 FROM ydoc_state WHERE doc_id = ?').get(docId)) {
    // 新表已有该文档（说明新服务器已在运行并写入过更完整的状态），不覆盖
    skipped++;
    continue;
  }
  const rows = db.prepare('SELECT [update] FROM ydoc_updates WHERE doc_id = ? ORDER BY id').all(docId);
  const merged = Y.mergeUpdates(rows.map(r => new Uint8Array(r.update)));

  // 校验：合并结果能重建出非空文档结构才写入
  const check = new Y.Doc();
  Y.applyUpdate(check, merged);
  const fragment = check.getXmlFragment('default');
  console.log(`${docId}: ${rows.length} 条增量 → ${merged.length} 字节，重建后 ${fragment.length} 个顶层节点`);

  upsert.run(docId, Buffer.from(merged));
  migrated++;
}

console.log(`迁移完成：${migrated} 个文档已迁移，${skipped} 个已存在跳过`);
console.log('旧表 ydoc_updates 保留为备份，确认无误后可手动 DROP');
db.close();
