import { Router } from 'express';
import { db } from './database.js';

export const api = Router();

// ---- 知识库 ----

api.get('/kb', (req, res) => {
  res.json(db.prepare('SELECT * FROM knowledge_bases').all());
});

api.post('/kb', (req, res) => {
  const info = db.prepare('INSERT INTO knowledge_bases (name) VALUES (?)').run(req.body.name);
  res.json(db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(info.lastInsertRowid));
});

api.patch('/kb/:id', (req, res) => {
  db.prepare('UPDATE knowledge_bases SET name = ? WHERE id = ?').run(req.body.name, req.params.id);
  res.json(db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id));
});

api.delete('/kb/:id', (req, res) => {
  const kbId = req.params.id;
  deleteDocs(db.prepare('SELECT id FROM documents WHERE kb_id = ?').all(kbId));
  const folders = collectFolderIds(db.prepare('SELECT id FROM folders WHERE kb_id = ?').all(kbId).map(f => f.id));
  for (const folderId of folders) {
    deleteDocs(db.prepare('SELECT id FROM documents WHERE folder_id = ?').all(folderId));
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  }
  db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(kbId);
  res.json({ status: 'ok' });
});

// ---- 文件夹 ----

api.get('/kb/:id/folders', (req, res) => {
  res.json(db.prepare('SELECT * FROM folders WHERE kb_id = ? AND parent_id IS NULL').all(req.params.id));
});

api.get('/folders/:id/subfolders', (req, res) => {
  res.json(db.prepare('SELECT * FROM folders WHERE parent_id = ?').all(req.params.id));
});

api.post('/folders', (req, res) => {
  const { name, kb_id, parent_id } = req.body;
  const info = db.prepare('INSERT INTO folders (name, kb_id, parent_id) VALUES (?, ?, ?)').run(name, kb_id, parent_id || null);
  res.json(db.prepare('SELECT * FROM folders WHERE id = ?').get(info.lastInsertRowid));
});

api.patch('/folders/:id', (req, res) => {
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(req.body.name, req.params.id);
  res.json(db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id));
});

api.delete('/folders/:id', (req, res) => {
  for (const folderId of collectFolderIds([Number(req.params.id)])) {
    deleteDocs(db.prepare('SELECT id FROM documents WHERE folder_id = ?').all(folderId));
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  }
  res.json({ status: 'ok' });
});

// ---- 文档 ----

api.get('/kb/:id/docs', (req, res) => {
  res.json(db.prepare('SELECT * FROM documents WHERE kb_id = ? AND folder_id IS NULL').all(req.params.id));
});

api.get('/folders/:id/docs', (req, res) => {
  res.json(db.prepare('SELECT * FROM documents WHERE folder_id = ?').all(req.params.id));
});

api.get('/search/docs', (req, res) => {
  res.json(db.prepare('SELECT id, title, folder_id FROM documents WHERE title LIKE ? LIMIT 20').all(`%${req.query.q || ''}%`));
});

api.get('/docs/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

api.post('/docs', (req, res) => {
  const { id, title, kb_id, folder_id, heading_numbered, bg_color, collapsed_blocks } = req.body;

  let finalKbId = kb_id;
  if (!finalKbId && folder_id) {
    const folder = db.prepare('SELECT kb_id FROM folders WHERE id = ?').get(folder_id);
    finalKbId = folder?.kb_id;
  }

  db.prepare(
    'INSERT INTO documents (id, title, kb_id, folder_id, heading_numbered, bg_color, collapsed_blocks) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, finalKbId || null, folder_id || null, heading_numbered || 0, bg_color || '#ffffff', collapsed_blocks || '');
  res.json(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
});

api.patch('/docs/:id', (req, res) => {
  const docId = req.params.id;
  const { title, folder_id, kb_id, heading_numbered, bg_color, collapsed_blocks } = req.body;

  if (title !== undefined) db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(title, docId);
  if (folder_id !== undefined) db.prepare('UPDATE documents SET folder_id = ?, kb_id = NULL WHERE id = ?').run(folder_id, docId);
  else if (kb_id !== undefined) db.prepare('UPDATE documents SET kb_id = ?, folder_id = NULL WHERE id = ?').run(kb_id, docId);
  if (heading_numbered !== undefined) db.prepare('UPDATE documents SET heading_numbered = ? WHERE id = ?').run(heading_numbered ? 1 : 0, docId);
  if (bg_color !== undefined) db.prepare('UPDATE documents SET bg_color = ? WHERE id = ?').run(bg_color, docId);
  if (collapsed_blocks !== undefined) db.prepare('UPDATE documents SET collapsed_blocks = ? WHERE id = ?').run(collapsed_blocks, docId);

  res.json(db.prepare('SELECT * FROM documents WHERE id = ?').get(docId));
});

api.delete('/docs/:id', (req, res) => {
  deleteDocs([{ id: req.params.id }]);
  res.json({ status: 'ok' });
});

api.get('/docs/:id/path', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  let kb_id = doc.kb_id;
  if (doc.folder_id) {
    const folder = db.prepare('SELECT kb_id FROM folders WHERE id = ?').get(doc.folder_id);
    kb_id = folder?.kb_id;
  }
  res.json({ doc_id: doc.id, folder_id: doc.folder_id, kb_id });
});

// ---- 内部工具 ----

function deleteDocs(rows) {
  for (const { id } of rows) {
    db.prepare('DELETE FROM ydoc_state WHERE doc_id = ?').run(id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }
}

function collectFolderIds(rootIds) {
  const all = [];
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift();
    all.push(id);
    for (const sub of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(id)) {
      queue.push(sub.id);
    }
  }
  return all;
}
