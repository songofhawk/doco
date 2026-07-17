import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from './database.js';
import {
  clearSessionCookie,
  createSession,
  deleteSessionFromCookieHeader,
  requestEmailLoginCode,
  requireAuth,
  setSessionCookie,
  updateUserAppearance,
  upsertGoogleUser,
  verifyEmailLoginCode,
  verifyGoogleCredential,
} from './auth.js';
import {
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
import { createApiToken, listApiTokens, revokeApiToken } from './open-api/tokens.js';
import { documents as documentService, folders as folderService, knowledgeBases as knowledgeBaseService } from './resource-service.js';
import { initializeStandaloneSpreadsheet } from './ydoc-service.js';

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

api.post('/auth/email/code', async (req, res) => {
  try {
    const result = await requestEmailLoginCode(req.body?.email, req.ip);
    res.json({
      status: 'ok',
      expiresInSeconds: result.expiresInSeconds,
      retryAfterSeconds: result.retryAfterSeconds,
    });
  } catch (error) {
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(error.statusCode || 500).json({
      error: error.message || '验证码发送失败',
      code: error.code,
    });
  }
});

api.post('/auth/email/verify', (req, res) => {
  try {
    const { user } = verifyEmailLoginCode(req.body?.email, req.body?.code);
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt, req);
    res.json({ user });
  } catch (error) {
    res.status(error.statusCode || 401).json({
      error: error.message || '邮箱登录失败',
      code: error.code,
    });
  }
});

api.post('/auth/logout', (req, res) => {
  deleteSessionFromCookieHeader(req.headers.cookie || '');
  clearSessionCookie(res, req);
  res.json({ status: 'ok' });
});

api.use(requireAuth);

api.patch('/auth/preferences', (req, res) => {
  try {
    const user = updateUserAppearance(req.user.id, req.body?.appearanceTheme);
    res.json({ user });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message || '外观设置保存失败',
      code: error.code,
    });
  }
});

// ---- 开放 API Token（只允许页面 Session Cookie） ----

api.get('/api-tokens', (req, res) => {
  res.json({ tokens: listApiTokens(req.user.id) });
});

api.post('/api-tokens', (req, res) => {
  try {
    res.status(201).json(createApiToken(req.user.id, req.body, req));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message, code: error.code });
  }
});

api.delete('/api-tokens/:id', (req, res) => {
  try {
    revokeApiToken(req.user.id, req.params.id, req);
    res.status(204).end();
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message, code: error.code });
  }
});

// 页面通过 Session Cookie 读取附件；开放 API 的同一资源仍只接受 Bearer Token。
api.get('/attachments/:id', (req, res) => {
  const attachment = db.prepare(`
    SELECT a.* FROM attachments a
    JOIN documents d ON d.id = a.doc_id
    LEFT JOIN folders f ON f.id = d.folder_id
    JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE a.id = ? AND wm.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!attachment) return res.status(404).json({ error: 'Not found' });
  res.type(attachment.mime_type)
    .set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
    .sendFile(attachment.filepath);
});

// ---- 知识库 ----

api.get('/kb', (req, res) => {
  res.json(listKnowledgeBasesForUser(req.user.id));
});

api.post('/kb', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '知识库名称不能为空' });

  try { res.json(knowledgeBaseService.create(req.user.id, { name })); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

api.patch('/kb/:id', (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '知识库名称不能为空' });

  try { res.json(knowledgeBaseService.update(req.user.id, kb.id, { name })); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

api.delete('/kb/:id', (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  knowledgeBaseService.remove(req.user.id, kb.id);
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

  try { res.json(folderService.create(req.user.id, { name, kb_id: kbId, parent_id: parentId })); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

api.patch('/folders/:id', (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });

  try { res.json(folderService.update(req.user.id, folder.id, { name })); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

api.delete('/folders/:id', (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  folderService.remove(req.user.id, folder.id);
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

api.post('/docs', async (req, res) => {
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
    const documentType = req.body?.document_type === 'spreadsheet' ? 'spreadsheet' : 'document';
    documentService.create(req.user.id, {
      id, title, folder_id: folderId, knowledge_base_id: kbId,
      document_type: documentType,
      heading_numbered: req.body?.heading_numbered,
      background_color: req.body?.bg_color,
      collapsed_block_ids: String(req.body?.collapsed_blocks || '').split(',').filter(Boolean),
    });
    if (documentType === 'spreadsheet') {
      initializeStandaloneSpreadsheet(id);
    }
    res.json(getDocumentForUser(req.user.id, id));
  } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

api.patch('/docs/:id', (req, res) => {
  const doc = getDocumentForUser(req.user.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  try {
    const body = req.body || {};
    const patch = {
      title: body.title,
      folder_id: body.folder_id,
      knowledge_base_id: body.kb_id,
      heading_numbered: body.heading_numbered,
      background_color: body.bg_color,
      collapsed_block_ids: body.collapsed_blocks === undefined ? undefined : String(body.collapsed_blocks).split(',').filter(Boolean),
    };
    if (body.kb_id !== undefined && body.folder_id === undefined) patch.folder_id = null;
    documentService.update(req.user.id, doc.id, patch);
    res.json(getDocumentForUser(req.user.id, doc.id));
  } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

api.delete('/docs/:id', (req, res) => {
  const doc = getDocumentForUser(req.user.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  documentService.remove(req.user.id, doc.id);
  res.json({ status: 'ok' });
});

api.get('/docs/:id/path', (req, res) => {
  const path = getDocumentPathForUser(req.user.id, req.params.id);
  if (!path) return res.status(404).json({ error: 'Not found' });
  res.json(path);
});
