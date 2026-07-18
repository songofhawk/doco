import { db } from './database.js';

export function getDefaultWorkspaceForUser(userId) {
  return db.prepare(`
    SELECT w.*
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = ?
    ORDER BY w.created_at ASC
    LIMIT 1
  `).get(userId);
}

export function listKnowledgeBasesForUser(userId) {
  return db.prepare(`
    SELECT kb.*
    FROM knowledge_bases kb
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE wm.user_id = ?
    ORDER BY kb.id ASC
  `).all(userId);
}

export function getKnowledgeBaseForUser(userId, kbId) {
  return db.prepare(`
    SELECT kb.*
    FROM knowledge_bases kb
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE kb.id = ? AND wm.user_id = ?
  `).get(kbId, userId);
}

export function getFolderForUser(userId, folderId) {
  return db.prepare(`
    SELECT f.*
    FROM folders f
    JOIN knowledge_bases kb ON kb.id = f.kb_id
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE f.id = ? AND wm.user_id = ?
  `).get(folderId, userId);
}

export function getDocumentForUser(userId, docId) {
  return db.prepare(`
    SELECT
      d.*,
      COALESCE(d.kb_id, f.kb_id) AS effective_kb_id,
      kb.workspace_id
    FROM documents d
    LEFT JOIN folders f ON f.id = d.folder_id
    JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE d.id = ? AND wm.user_id = ?
  `).get(docId, userId);
}

export function userCanAccessDocument(userId, docId) {
  return !!getDocumentForUser(userId, docId);
}

export function getAttachmentForUser(userId, attachmentId) {
  return db.prepare(`
    SELECT a.* FROM attachments a
    JOIN documents d ON d.id = a.doc_id
    LEFT JOIN folders f ON f.id = d.folder_id
    JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE a.id = ? AND wm.user_id = ?
  `).get(attachmentId, userId);
}

export function listRootFoldersForUser(userId, kbId) {
  return db.prepare(`
    SELECT f.*
    FROM folders f
    JOIN knowledge_bases kb ON kb.id = f.kb_id
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE f.kb_id = ? AND f.parent_id IS NULL AND wm.user_id = ?
    ORDER BY f.id ASC
  `).all(kbId, userId);
}

export function listSubfoldersForUser(userId, folderId) {
  return db.prepare(`
    SELECT child.*
    FROM folders parent
    JOIN folders child ON child.parent_id = parent.id
    JOIN knowledge_bases kb ON kb.id = parent.kb_id
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE parent.id = ? AND wm.user_id = ?
    ORDER BY child.id ASC
  `).all(folderId, userId);
}

export function listRootDocsForUser(userId, kbId) {
  return db.prepare(`
    SELECT d.*
    FROM documents d
    JOIN knowledge_bases kb ON kb.id = d.kb_id
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE d.kb_id = ? AND d.folder_id IS NULL AND wm.user_id = ?
    ORDER BY d.title COLLATE NOCASE ASC
  `).all(kbId, userId);
}

export function listFolderDocsForUser(userId, folderId) {
  return db.prepare(`
    SELECT d.*
    FROM documents d
    JOIN folders f ON f.id = d.folder_id
    JOIN knowledge_bases kb ON kb.id = f.kb_id
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE d.folder_id = ? AND wm.user_id = ?
    ORDER BY d.title COLLATE NOCASE ASC
  `).all(folderId, userId);
}

export function searchDocsForUser(userId, query) {
  return db.prepare(`
    SELECT d.id, d.title, d.folder_id, d.document_type, COALESCE(d.kb_id, f.kb_id) AS kb_id
    FROM documents d
    LEFT JOIN folders f ON f.id = d.folder_id
    JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
    JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE wm.user_id = ? AND d.title LIKE ?
    ORDER BY d.title COLLATE NOCASE ASC
    LIMIT 20
  `).all(userId, `%${query || ''}%`);
}

export function getDocumentPathForUser(userId, docId) {
  const doc = getDocumentForUser(userId, docId);
  if (!doc) return null;

  return {
    doc_id: doc.id,
    folder_id: doc.folder_id,
    kb_id: doc.effective_kb_id,
  };
}
