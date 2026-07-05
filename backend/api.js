import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from './database.js';
import {
  clearSessionCookie,
  createSession,
  deleteSessionFromCookieHeader,
  requireAuth,
  setSessionCookie,
  upsertGoogleUser,
  verifyGoogleCredential,
} from './auth.js';
import {
  getDefaultWorkspaceForUser,
  getDocumentForUser,
  getDocumentPathForUser,
  getFolderForUser,
  getKnowledgeBaseForUser,
  listFolderDocsForUser,
  listKnowledgeBasesForUser,
  listRootDocsForUser,
  listRootFoldersForUser,
  listSubfoldersForUser,
  searchDocsForUser,
} from './permissions.js';

export const api = Router();

// ---- 认证 ----

api.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

api.post('/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });

    const payload = await verifyGoogleCredential(credential);
    const { user } = upsertGoogleUser(payload);
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt, req);
    res.json({ user });
  } catch (error) {
    const status = error.statusCode || 401;
    res.status(status).json({ error: error.message || 'Google 登录失败' });
  }
});

api.post('/auth/logout', (req, res) => {
  deleteSessionFromCookieHeader(req.headers.cookie || '');
  clearSessionCookie(res, req);
  res.json({ status: 'ok' });
});

api.use(requireAuth);

// ---- 知识库 ----

api.get('/kb', (req, res) => {
  res.json(listKnowledgeBasesForUser(req.user.id));
});

api.post('/kb', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '知识库名称不能为空' });

  const workspace = getDefaultWorkspaceForUser(req.user.id);
  if (!workspace) return res.status(500).json({ error: '未找到默认工作区' });

  const info = db.prepare('INSERT INTO knowledge_bases (name, workspace_id) VALUES (?, ?)').run(name, workspace.id);
  res.json(getKnowledgeBaseForUser(req.user.id, info.lastInsertRowid));
});

api.patch('/kb/:id', (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '知识库名称不能为空' });

  db.prepare('UPDATE knowledge_bases SET name = ? WHERE id = ?').run(name, kb.id);
  res.json(getKnowledgeBaseForUser(req.user.id, kb.id));
});

api.delete('/kb/:id', (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  deleteDocs(db.prepare('SELECT id FROM documents WHERE kb_id = ?').all(kb.id));
  const folders = collectFolderIds(db.prepare('SELECT id FROM folders WHERE kb_id = ?').all(kb.id).map(f => f.id));
  for (const folderId of folders) {
    deleteDocs(db.prepare('SELECT id FROM documents WHERE folder_id = ?').all(folderId));
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  }
  db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(kb.id);
  res.json({ status: 'ok' });
});

// ---- 文件夹 ----

api.get('/kb/:id/folders', (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });
  res.json(listRootFoldersForUser(req.user.id, kb.id));
});

api.get('/folders/:id/subfolders', (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });
  res.json(listSubfoldersForUser(req.user.id, folder.id));
});

api.post('/folders', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const parentId = req.body?.parent_id || null;
  let kbId = req.body?.kb_id || null;
  if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });

  if (parentId) {
    const parent = getFolderForUser(req.user.id, parentId);
    if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
    if (kbId && Number(kbId) !== parent.kb_id) {
      return res.status(400).json({ error: '父文件夹与目标知识库不一致' });
    }
    kbId = parent.kb_id;
  } else {
    const kb = getKnowledgeBaseForUser(req.user.id, kbId);
    if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
    kbId = kb.id;
  }

  const info = db.prepare('INSERT INTO folders (name, kb_id, parent_id) VALUES (?, ?, ?)').run(name, kbId, parentId);
  res.json(getFolderForUser(req.user.id, info.lastInsertRowid));
});

api.patch('/folders/:id', (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });

  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folder.id);
  res.json(getFolderForUser(req.user.id, folder.id));
});

api.delete('/folders/:id', (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  for (const folderId of collectFolderIds([Number(folder.id)])) {
    deleteDocs(db.prepare('SELECT id FROM documents WHERE folder_id = ?').all(folderId));
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  }
  res.json({ status: 'ok' });
});

// ---- 文档 ----

api.get('/kb/:id/docs', (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });
  res.json(listRootDocsForUser(req.user.id, kb.id));
});

api.get('/folders/:id/docs', (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });
  res.json(listFolderDocsForUser(req.user.id, folder.id));
});

api.get('/search/docs', (req, res) => {
  res.json(searchDocsForUser(req.user.id, req.query.q || ''));
});

api.get('/docs/:id', (req, res) => {
  const doc = getDocumentForUser(req.user.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

api.post('/docs', (req, res) => {
  const title = String(req.body?.title || '').trim();
  const id = String(req.body?.id || `doc_${randomUUID()}`).trim();
  const folderId = req.body?.folder_id || null;
  let kbId = req.body?.kb_id || null;

  if (!title) return res.status(400).json({ error: '文档标题不能为空' });
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) return res.status(400).json({ error: '文档 ID 非法' });

  if (folderId) {
    const folder = getFolderForUser(req.user.id, folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    if (kbId && Number(kbId) !== folder.kb_id) {
      return res.status(400).json({ error: '文件夹与目标知识库不一致' });
    }
    kbId = folder.kb_id;
  } else {
    const kb = getKnowledgeBaseForUser(req.user.id, kbId);
    if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
    kbId = kb.id;
  }

  try {
    db.prepare(`
      INSERT INTO documents (id, title, kb_id, folder_id, heading_numbered, bg_color, collapsed_blocks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      folderId ? null : kbId,
      folderId,
      req.body?.heading_numbered || 0,
      req.body?.bg_color || '#ffffff',
      req.body?.collapsed_blocks || '',
    );
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return res.status(409).json({ error: '文档 ID 已存在' });
    }
    throw error;
  }

  res.json(getDocumentForUser(req.user.id, id));
});

api.patch('/docs/:id', (req, res) => {
  const doc = getDocumentForUser(req.user.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const { title, folder_id, kb_id, heading_numbered, bg_color, collapsed_blocks } = req.body;
  const docId = doc.id;

  if (title !== undefined) {
    const trimmedTitle = String(title).trim();
    if (!trimmedTitle) return res.status(400).json({ error: '文档标题不能为空' });
    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(trimmedTitle, docId);
  }

  if (folder_id !== undefined) {
    if (folder_id === null) {
      const targetKb = getKnowledgeBaseForUser(req.user.id, kb_id);
      if (!targetKb) return res.status(404).json({ error: 'Target knowledge base not found' });
      db.prepare('UPDATE documents SET folder_id = NULL, kb_id = ? WHERE id = ?').run(targetKb.id, docId);
    } else {
      const targetFolder = getFolderForUser(req.user.id, folder_id);
      if (!targetFolder) return res.status(404).json({ error: 'Target folder not found' });
      db.prepare('UPDATE documents SET folder_id = ?, kb_id = NULL WHERE id = ?').run(targetFolder.id, docId);
    }
  } else if (kb_id !== undefined) {
    const targetKb = getKnowledgeBaseForUser(req.user.id, kb_id);
    if (!targetKb) return res.status(404).json({ error: 'Target knowledge base not found' });
    db.prepare('UPDATE documents SET kb_id = ?, folder_id = NULL WHERE id = ?').run(targetKb.id, docId);
  }

  if (heading_numbered !== undefined) db.prepare('UPDATE documents SET heading_numbered = ? WHERE id = ?').run(heading_numbered ? 1 : 0, docId);
  if (bg_color !== undefined) db.prepare('UPDATE documents SET bg_color = ? WHERE id = ?').run(bg_color, docId);
  if (collapsed_blocks !== undefined) db.prepare('UPDATE documents SET collapsed_blocks = ? WHERE id = ?').run(collapsed_blocks, docId);

  res.json(getDocumentForUser(req.user.id, docId));
});

api.delete('/docs/:id', (req, res) => {
  const doc = getDocumentForUser(req.user.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  deleteDocs([{ id: doc.id }]);
  res.json({ status: 'ok' });
});

api.get('/docs/:id/path', (req, res) => {
  const path = getDocumentPathForUser(req.user.id, req.params.id);
  if (!path) return res.status(404).json({ error: 'Not found' });
  res.json(path);
});

// ---- 内部工具 ----

function deleteDocs(rows) {
  for (const { id } of rows) {
    db.prepare('DELETE FROM attachments WHERE doc_id = ?').run(id);
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
