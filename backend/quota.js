import * as Y from 'yjs';
import { db } from './database.js';
import { ApiError } from './open-api/errors.js';

const DEFAULT_LIMITS = Object.freeze({
  knowledgeBases: 100,
  documentsAndFolders: 10_000,
  folderDepth: 20,
  documentCharacters: 100_000,
  ydocSnapshotBytes: 5 * 1024 * 1024,
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getQuotaLimits() {
  return {
    knowledgeBases: positiveInteger(process.env.DOCO_MAX_KNOWLEDGE_BASES, DEFAULT_LIMITS.knowledgeBases),
    documentsAndFolders: positiveInteger(process.env.DOCO_MAX_DOCUMENTS_AND_FOLDERS, DEFAULT_LIMITS.documentsAndFolders),
    folderDepth: positiveInteger(process.env.DOCO_MAX_FOLDER_DEPTH, DEFAULT_LIMITS.folderDepth),
    documentCharacters: positiveInteger(process.env.DOCO_MAX_DOCUMENT_CHARACTERS, DEFAULT_LIMITS.documentCharacters),
    ydocSnapshotBytes: positiveInteger(process.env.DOCO_MAX_YDOC_SNAPSHOT_BYTES, DEFAULT_LIMITS.ydocSnapshotBytes),
  };
}

function quotaError(code, message, details) {
  return new ApiError(409, code, message, details);
}

export function assertKnowledgeBaseQuota(workspaceId) {
  const limit = getQuotaLimits().knowledgeBases;
  const current = db.prepare('SELECT COUNT(*) AS count FROM knowledge_bases WHERE workspace_id = ?').get(workspaceId).count;
  if (current >= limit) {
    throw quotaError('knowledge_base_quota_exceeded', `知识库数量已达到上限（${limit} 个）`, { current, limit });
  }
}

export function countDocumentsAndFolders(workspaceId) {
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM folders f
        JOIN knowledge_bases kb ON kb.id = f.kb_id
        WHERE kb.workspace_id = @workspaceId)
      +
      (SELECT COUNT(*) FROM documents d
        LEFT JOIN folders f ON f.id = d.folder_id
        JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
        WHERE kb.workspace_id = @workspaceId) AS count
  `).get({ workspaceId }).count;
}

export function getWorkspaceQuotaUsage(workspaceId) {
  const limits = getQuotaLimits();
  const usage = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM knowledge_bases
        WHERE workspace_id = @workspaceId) AS knowledge_bases,
      (SELECT COUNT(*) FROM folders f
        JOIN knowledge_bases kb ON kb.id = f.kb_id
        WHERE kb.workspace_id = @workspaceId) AS folders,
      (SELECT COUNT(*) FROM documents d
        LEFT JOIN folders f ON f.id = d.folder_id
        JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
        WHERE kb.workspace_id = @workspaceId) AS documents
  `).get({ workspaceId });

  return {
    workspace_id: workspaceId,
    knowledge_bases: {
      used: usage.knowledge_bases,
      limit: limits.knowledgeBases,
    },
    documents_and_folders: {
      used: usage.documents + usage.folders,
      limit: limits.documentsAndFolders,
      documents: usage.documents,
      folders: usage.folders,
    },
    per_document: {
      character_limit: limits.documentCharacters,
      ydoc_snapshot_byte_limit: limits.ydocSnapshotBytes,
    },
    folder_depth_limit: limits.folderDepth,
  };
}

export function assertDocumentsAndFoldersQuota(workspaceId) {
  const limit = getQuotaLimits().documentsAndFolders;
  const current = countDocumentsAndFolders(workspaceId);
  if (current >= limit) {
    throw quotaError('resource_quota_exceeded', `文档和文件夹总数已达到上限（${limit} 个）`, { current, limit });
  }
}

export function folderDepth(folderId) {
  let depth = 0;
  let currentId = folderId == null ? null : Number(folderId);
  const visited = new Set();
  while (currentId != null) {
    if (visited.has(currentId)) throw new ApiError(409, 'folder_cycle', '文件夹层级存在循环');
    visited.add(currentId);
    const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(currentId);
    if (!row) break;
    depth += 1;
    currentId = row.parent_id;
  }
  return depth;
}

function subtreeHeight(folderId) {
  let maxDepth = 1;
  const queue = [{ id: Number(folderId), depth: 1 }];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) throw new ApiError(409, 'folder_cycle', '文件夹层级存在循环');
    visited.add(current.id);
    maxDepth = Math.max(maxDepth, current.depth);
    for (const child of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(current.id)) {
      queue.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  return maxDepth;
}

export function assertFolderPlacement(parentId, movingFolderId = null) {
  const limit = getQuotaLimits().folderDepth;
  const parentDepth = parentId == null ? 0 : folderDepth(parentId);
  const height = movingFolderId == null ? 1 : subtreeHeight(movingFolderId);
  const resultingDepth = parentDepth + height;
  if (resultingDepth > limit) {
    throw quotaError('folder_depth_exceeded', `文件夹最多允许嵌套 ${limit} 层`, { resulting_depth: resultingDepth, limit });
  }
}

function collectVisibleText(node, parts) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
  if ((node.type === 'mermaidBlock' || node.type === 'plantUMLBlock') && typeof node.attrs?.code === 'string') {
    parts.push(node.attrs.code);
  }
  if (node.type === 'spreadsheetBlock' && node.attrs?.data?.cells && typeof node.attrs.data.cells === 'object') {
    parts.push(Object.values(node.attrs.data.cells).join(''));
  }
  if (Array.isArray(node.content)) node.content.forEach((child) => collectVisibleText(child, parts));
}

export function countVisibleCharacters(document) {
  const parts = [];
  collectVisibleText(document, parts);
  return Array.from(parts.join('').replace(/\s/gu, '')).length;
}

export function ydocMetrics(ydoc, document) {
  let characters = countVisibleCharacters(document);
  const spreadsheet = ydoc.getMap('spreadsheet').get('data');
  if (spreadsheet && typeof spreadsheet === 'object' && spreadsheet.cells && typeof spreadsheet.cells === 'object') {
    characters += Array.from(Object.values(spreadsheet.cells).join('').replace(/\s/gu, '')).length;
  }
  return {
    characters,
    snapshotBytes: Y.encodeStateAsUpdate(ydoc).byteLength,
  };
}

export function assertYDocChangeWithinQuota(before, after) {
  const limits = getQuotaLimits();
  const characterExceeded = after.characters > limits.documentCharacters
    && after.characters >= before.characters;
  if (characterExceeded) {
    throw quotaError('document_character_limit_exceeded', `文档正文最多允许 ${limits.documentCharacters} 个非空白可见字符`, {
      current: after.characters,
      previous: before.characters,
      limit: limits.documentCharacters,
    });
  }

  const snapshotExceeded = after.snapshotBytes > limits.ydocSnapshotBytes
    && after.snapshotBytes >= before.snapshotBytes
    && after.characters >= before.characters;
  if (snapshotExceeded) {
    throw quotaError('document_snapshot_limit_exceeded', `文档协同快照最多允许 ${limits.ydocSnapshotBytes} 字节`, {
      current: after.snapshotBytes,
      previous: before.snapshotBytes,
      limit: limits.ydocSnapshotBytes,
    });
  }
}
