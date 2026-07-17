import { randomUUID } from 'crypto';
import { unlinkSync } from 'fs';
import { db } from './database.js';
import {
  getDefaultWorkspaceForUser, getDocumentForUser, getFolderForUser, getKnowledgeBaseForUser,
  listFolderDocsForUser, listKnowledgeBasesForUser, listRootDocsForUser, listRootFoldersForUser,
  listSubfoldersForUser,
} from './permissions.js';
import { ApiError } from './open-api/errors.js';
import {
  assertDocumentsAndFoldersQuota,
  assertFolderPlacement,
  assertKnowledgeBaseQuota,
} from './quota.js';

function requiredName(value, label) {
  const name = String(value || '').trim();
  if (!name || name.length > 200) throw new ApiError(400, 'invalid_name', `${label}长度必须为 1 到 200 个字符`);
  return name;
}

function notFound(type) { throw new ApiError(404, `${type}_not_found`, '资源不存在'); }

export function serializeDocument(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    knowledge_base_id: doc.effective_kb_id ?? doc.kb_id,
    folder_id: doc.folder_id,
    document_type: doc.document_type || 'document',
    created_by_user_id: doc.created_by_user_id,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    heading_numbered: Boolean(doc.heading_numbered),
    background_color: doc.bg_color,
    collapsed_block_ids: String(doc.collapsed_blocks || '').split(',').filter(Boolean),
  };
}

export const knowledgeBases = {
  list(userId) { return listKnowledgeBasesForUser(userId); },
  get(userId, id) { return getKnowledgeBaseForUser(userId, id) || notFound('knowledge_base'); },
  create(userId, body) {
    const workspace = getDefaultWorkspaceForUser(userId);
    if (!workspace) throw new ApiError(500, 'workspace_not_found', '未找到默认工作区');
    const name = requiredName(body?.name, '知识库名称');
    const id = db.transaction(() => {
      assertKnowledgeBaseQuota(workspace.id);
      const timestamp = Date.now();
      return db.prepare(`
        INSERT INTO knowledge_bases (name, workspace_id, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, workspace.id, userId, timestamp, timestamp).lastInsertRowid;
    })();
    return this.get(userId, id);
  },
  update(userId, id, body) {
    const kb = this.get(userId, id);
    db.prepare('UPDATE knowledge_bases SET name = ?, updated_at = ? WHERE id = ?')
      .run(requiredName(body?.name, '知识库名称'), Date.now(), kb.id);
    return this.get(userId, kb.id);
  },
  remove(userId, id) {
    const kb = this.get(userId, id);
    const ids = db.prepare(`
      SELECT d.id FROM documents d LEFT JOIN folders f ON f.id = d.folder_id
      WHERE COALESCE(d.kb_id, f.kb_id) = ?
    `).all(kb.id).map((row) => row.id);
    db.transaction(() => {
      ids.forEach(deleteDocumentData);
      db.prepare('DELETE FROM folders WHERE kb_id = ?').run(kb.id);
      db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(kb.id);
    })();
  },
  tree(userId, id) {
    const kb = this.get(userId, id);
    const folderNode = (folder) => ({
      ...folder,
      folders: listSubfoldersForUser(userId, folder.id).map(folderNode),
      documents: listFolderDocsForUser(userId, folder.id).map(serializeDocument),
    });
    return {
      ...kb,
      folders: listRootFoldersForUser(userId, kb.id).map(folderNode),
      documents: listRootDocsForUser(userId, kb.id).map(serializeDocument),
    };
  },
};

function descendantFolderIds(id) {
  const result = [];
  const queue = [Number(id)];
  while (queue.length) {
    const current = queue.shift();
    result.push(current);
    queue.push(...db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(current).map((row) => row.id));
  }
  return result;
}

export const folders = {
  get(userId, id) { return getFolderForUser(userId, id) || notFound('folder'); },
  create(userId, body) {
    const name = requiredName(body?.name, '文件夹名称');
    let kbId = body?.knowledge_base_id ?? body?.kb_id;
    const parentId = body?.parent_id ?? null;
    if (parentId) {
      const parent = this.get(userId, parentId);
      if (kbId != null && Number(kbId) !== parent.kb_id) throw new ApiError(400, 'folder_parent_mismatch', '父文件夹与知识库不一致');
      kbId = parent.kb_id;
    } else {
      kbId = knowledgeBases.get(userId, kbId).id;
    }
    const kb = knowledgeBases.get(userId, kbId);
    assertFolderPlacement(parentId);
    const id = db.transaction(() => {
      assertDocumentsAndFoldersQuota(kb.workspace_id);
      const timestamp = Date.now();
      return db.prepare(`
        INSERT INTO folders (name, kb_id, parent_id, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, kbId, parentId, userId, timestamp, timestamp).lastInsertRowid;
    })();
    return this.get(userId, id);
  },
  update(userId, id, body) {
    const folder = this.get(userId, id);
    let name = folder.name;
    if (body?.name !== undefined) name = requiredName(body.name, '文件夹名称');
    let parentId = folder.parent_id;
    let kbId = folder.kb_id;
    if (body?.parent_id !== undefined || body?.knowledge_base_id !== undefined) {
      parentId = body.parent_id ?? null;
      if (parentId) {
        const target = this.get(userId, parentId);
        if (descendantFolderIds(folder.id).includes(Number(target.id))) {
          throw new ApiError(409, 'folder_cycle', '文件夹不能移动到自身或后代');
        }
        kbId = target.kb_id;
      } else {
        kbId = knowledgeBases.get(userId, body.knowledge_base_id ?? folder.kb_id).id;
      }
      assertFolderPlacement(parentId, folder.id);
    }
    const subtree = descendantFolderIds(folder.id);
    db.transaction(() => {
      db.prepare('UPDATE folders SET name = ?, parent_id = ?, kb_id = ?, updated_at = ? WHERE id = ?')
        .run(name, parentId, kbId, Date.now(), folder.id);
      if (kbId !== folder.kb_id) {
        for (const childId of subtree.slice(1)) {
          db.prepare('UPDATE folders SET kb_id = ?, updated_at = ? WHERE id = ?').run(kbId, Date.now(), childId);
        }
      }
    })();
    return this.get(userId, folder.id);
  },
  remove(userId, id) {
    const folder = this.get(userId, id);
    const subtree = descendantFolderIds(folder.id).reverse();
    db.transaction(() => {
      for (const folderId of subtree) {
        db.prepare('SELECT id FROM documents WHERE folder_id = ?').all(folderId).forEach((row) => deleteDocumentData(row.id));
        db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
      }
    })();
  },
  children(userId, id) {
    const folder = this.get(userId, id);
    return { folders: listSubfoldersForUser(userId, folder.id), documents: listFolderDocsForUser(userId, folder.id).map(serializeDocument) };
  },
};

function encodeCursor(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function decodeCursor(value) {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')); }
  catch { throw new ApiError(400, 'invalid_cursor', '分页游标非法'); }
}

export const documents = {
  get(userId, id) {
    const doc = getDocumentForUser(userId, id);
    if (!doc) notFound('document');
    return serializeDocument(doc);
  },
  list(userId, query) {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const cursor = decodeCursor(query.cursor);
    const params = [userId];
    let where = 'wm.user_id = ?';
    if (query.q) { where += ' AND d.title LIKE ?'; params.push(`%${query.q}%`); }
    if (query.knowledge_base_id) { where += ' AND COALESCE(d.kb_id, f.kb_id) = ?'; params.push(query.knowledge_base_id); }
    if (query.folder_id === 'null') where += ' AND d.folder_id IS NULL';
    else if (query.folder_id) { where += ' AND d.folder_id = ?'; params.push(query.folder_id); }
    if (cursor?.id) { where += ' AND d.id > ?'; params.push(cursor.id); }
    params.push(limit + 1);
    const rows = db.prepare(`
      SELECT d.*, COALESCE(d.kb_id, f.kb_id) AS effective_kb_id
      FROM documents d LEFT JOIN folders f ON f.id = d.folder_id
      JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
      JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
      WHERE ${where} ORDER BY d.id ASC LIMIT ?
    `).all(...params);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    return {
      data: pageRows.map(serializeDocument),
      page: { cursor: query.cursor || null, next_cursor: hasMore ? encodeCursor({ id: pageRows.at(-1).id }) : null, has_more: hasMore },
    };
  },
  create(userId, body) {
    const title = requiredName(body?.title, '文档标题');
    const id = String(body?.id || `doc_${randomUUID()}`);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new ApiError(400, 'invalid_document_id', '文档 ID 非法');
    const folderId = body?.folder_id ?? null;
    let kbId = body?.knowledge_base_id ?? body?.kb_id;
    if (folderId) kbId = folders.get(userId, folderId).kb_id;
    else kbId = knowledgeBases.get(userId, kbId).id;
    const kb = knowledgeBases.get(userId, kbId);
    try {
      db.transaction(() => {
        assertDocumentsAndFoldersQuota(kb.workspace_id);
        const timestamp = Date.now();
        db.prepare(`
          INSERT INTO documents (
            id, title, kb_id, folder_id, document_type, heading_numbered, bg_color, collapsed_blocks,
            created_by_user_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, title, folderId ? null : kbId, folderId,
          body.document_type === 'spreadsheet' ? 'spreadsheet' : 'document', body.heading_numbered ? 1 : 0,
          body.background_color || body.bg_color || '#ffffff', (body.collapsed_block_ids || []).join(','),
          userId, timestamp, timestamp);
      })();
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'document_id_conflict', '文档 ID 已存在');
      throw error;
    }
    return this.get(userId, id);
  },
  update(userId, id, body) {
    this.get(userId, id);
    if (body.title !== undefined) db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(requiredName(body.title, '文档标题'), id);
    if (body.folder_id !== undefined || body.knowledge_base_id !== undefined) {
      if (body.folder_id != null) {
        const target = folders.get(userId, body.folder_id);
        db.prepare('UPDATE documents SET folder_id = ?, kb_id = NULL WHERE id = ?').run(target.id, id);
      } else {
        const target = knowledgeBases.get(userId, body.knowledge_base_id);
        db.prepare('UPDATE documents SET folder_id = NULL, kb_id = ? WHERE id = ?').run(target.id, id);
      }
    }
    if (body.heading_numbered !== undefined) db.prepare('UPDATE documents SET heading_numbered = ? WHERE id = ?').run(body.heading_numbered ? 1 : 0, id);
    if (body.background_color !== undefined) db.prepare('UPDATE documents SET bg_color = ? WHERE id = ?').run(String(body.background_color), id);
    if (body.collapsed_block_ids !== undefined) db.prepare('UPDATE documents SET collapsed_blocks = ? WHERE id = ?').run(body.collapsed_block_ids.join(','), id);
    db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    return this.get(userId, id);
  },
  remove(userId, id) { this.get(userId, id); db.transaction(() => deleteDocumentData(id))(); },
  path(userId, id) {
    const doc = getDocumentForUser(userId, id);
    if (!doc) notFound('document');
    const foldersPath = [];
    let current = doc.folder_id ? getFolderForUser(userId, doc.folder_id) : null;
    while (current) { foldersPath.unshift({ id: current.id, name: current.name }); current = current.parent_id ? getFolderForUser(userId, current.parent_id) : null; }
    const kb = knowledgeBases.get(userId, doc.effective_kb_id);
    return { knowledge_base: { id: kb.id, name: kb.name }, folders: foldersPath, document: { id: doc.id, title: doc.title } };
  },
};

export function deleteDocumentData(id) {
  for (const attachment of db.prepare('SELECT filepath FROM attachments WHERE doc_id = ?').all(id)) {
    try { unlinkSync(attachment.filepath); } catch {}
  }
  db.prepare('DELETE FROM attachments WHERE doc_id = ?').run(id);
  db.prepare('DELETE FROM ydoc_state WHERE doc_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
}
