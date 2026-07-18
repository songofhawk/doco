import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import JSZip from 'jszip';
import multer from 'multer';
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from 'y-prosemirror';
import { db } from './database.js';
import { documentSchema } from './document-schema.js';
import { requireAuth } from './auth.js';
import {
  getDocumentForUser,
  getFolderForUser,
  getKnowledgeBaseForUser,
  listFolderDocsForUser,
  listRootDocsForUser,
  listRootFoldersForUser,
  listSubfoldersForUser,
} from './permissions.js';
import { documents, folders, knowledgeBases } from './resource-service.js';
import { assertYDocChangeWithinQuota, ydocMetrics } from './quota.js';

const FORMAT = 'doco-native-transfer';
const FORMAT_VERSION = 1;
const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const MAX_TRANSFER_BYTES = positiveInteger(process.env.DOCO_MAX_TRANSFER_BYTES, 250 * 1024 * 1024);
const MAX_TRANSFER_ENTRIES = positiveInteger(process.env.DOCO_MAX_TRANSFER_ENTRIES, 20_000);
const attachmentDir = resolve(process.env.DOCO_ATTACHMENTS_PATH || join(fileURLToPath(new URL('.', import.meta.url)), 'attachments'));
mkdirSync(attachmentDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TRANSFER_BYTES, files: 1, fields: 4 },
});

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function safeName(value, fallback = '未命名') {
  const name = String(value || '').trim();
  return name.slice(0, 200) || fallback;
}

function downloadName(value) {
  return safeName(value).replace(/[\\/:*?"<>|]/g, '_');
}

function documentMetadata(doc, statePath, state) {
  return {
    source_id: String(doc.id),
    title: doc.title,
    document_type: doc.document_type || 'document',
    heading_numbered: Boolean(doc.heading_numbered),
    background_color: doc.bg_color || '#ffffff',
    collapsed_block_ids: String(doc.collapsed_blocks || '').split(',').filter(Boolean),
    state_path: statePath,
    state_sha256: sha256(state),
  };
}

function folderTree(userId, folder, documentIds) {
  const childDocuments = listFolderDocsForUser(userId, folder.id);
  childDocuments.forEach((doc) => documentIds.add(String(doc.id)));
  return {
    type: 'folder',
    source_id: String(folder.id),
    name: folder.name,
    documents: childDocuments.map((doc) => String(doc.id)),
    folders: listSubfoldersForUser(userId, folder.id).map((child) => folderTree(userId, child, documentIds)),
  };
}

function exportSelection(userId, scope, id) {
  const documentIds = new Set();
  if (scope === 'document') {
    const doc = getDocumentForUser(userId, id);
    if (!doc) fail(404, 'document_not_found', '文档不存在');
    documentIds.add(String(doc.id));
    return {
      root: { type: 'document', document_source_id: String(doc.id), name: doc.title },
      documentIds,
      name: doc.title,
    };
  }
  if (scope === 'folder') {
    const folder = getFolderForUser(userId, id);
    if (!folder) fail(404, 'folder_not_found', '文件夹不存在');
    return { root: folderTree(userId, folder, documentIds), documentIds, name: folder.name };
  }
  if (scope === 'knowledge-base') {
    const kb = getKnowledgeBaseForUser(userId, id);
    if (!kb) fail(404, 'knowledge_base_not_found', '知识库不存在');
    const rootDocs = listRootDocsForUser(userId, kb.id);
    rootDocs.forEach((doc) => documentIds.add(String(doc.id)));
    return {
      root: {
        type: 'knowledge_base',
        source_id: String(kb.id),
        name: kb.name,
        documents: rootDocs.map((doc) => String(doc.id)),
        folders: listRootFoldersForUser(userId, kb.id).map((folder) => folderTree(userId, folder, documentIds)),
      },
      documentIds,
      name: kb.name,
    };
  }
  fail(400, 'invalid_transfer_scope', '不支持的迁移范围');
}

function collectAttachments(documentIds) {
  if (!documentIds.size) return [];
  const placeholders = Array.from(documentIds, () => '?').join(',');
  return db.prepare(`SELECT * FROM attachments WHERE doc_id IN (${placeholders}) ORDER BY id`).all(...documentIds);
}

function packagePath(kind, id, filename = '') {
  const safeId = Buffer.from(String(id)).toString('base64url');
  return filename ? `${kind}/${safeId}/${filename}` : `${kind}/${safeId}`;
}

async function buildPackage(userId, scope, id, getLatestDocState) {
  const selection = exportSelection(userId, scope, id);
  const zip = new JSZip();
  const packagedDocuments = [];
  let totalBytes = 0;
  const addSize = (size) => {
    totalBytes += size;
    if (totalBytes > MAX_TRANSFER_BYTES) fail(413, 'transfer_too_large', '迁移内容超过原生包大小限制');
  };

  for (const sourceId of selection.documentIds) {
    const doc = getDocumentForUser(userId, sourceId);
    if (!doc) fail(404, 'document_not_found', `文档 ${sourceId} 不存在`);
    const ydoc = getLatestDocState(sourceId);
    const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    addSize(state.length);
    const statePath = packagePath('documents', sourceId, 'ydoc.bin');
    zip.file(statePath, state);
    packagedDocuments.push(documentMetadata(doc, statePath, state));
  }

  const packagedAttachments = [];
  for (const attachment of collectAttachments(selection.documentIds)) {
    if (!existsSync(attachment.filepath)) {
      fail(409, 'attachment_file_missing', `附件 ${attachment.filename} 的文件不存在，无法无损导出`);
    }
    const data = readFileSync(attachment.filepath);
    addSize(data.length);
    const path = packagePath('attachments', attachment.id, 'content.bin');
    zip.file(path, data);
    packagedAttachments.push({
      source_id: attachment.id,
      document_source_id: String(attachment.doc_id),
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: data.length,
      path,
      sha256: sha256(data),
    });
  }

  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    scope: { type: scope, name: selection.name },
    root: selection.root,
    documents: packagedDocuments,
    attachments: packagedAttachments,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  addSize(Buffer.byteLength(manifestJson));
  zip.file('manifest.json', manifestJson);
  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    filename: `${downloadName(selection.name)}.doco.zip`,
  };
}

function validatePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    fail(400, 'invalid_transfer_path', '迁移包包含非法路径');
  }
  return path;
}

async function readEntry(zip, path, total) {
  const entry = zip.file(validatePath(path));
  if (!entry) fail(400, 'transfer_entry_missing', `迁移包缺少 ${path}`);
  const data = await entry.async('nodebuffer');
  total.value += data.length;
  if (total.value > MAX_TRANSFER_BYTES) fail(413, 'transfer_too_large', '迁移包解压后超过大小限制');
  return data;
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== FORMAT) fail(400, 'invalid_transfer_format', '这不是 Doco 原生迁移包');
  if (manifest.version !== FORMAT_VERSION) fail(409, 'unsupported_transfer_version', `暂不支持迁移包版本 ${manifest.version}`);
  if (!['document', 'folder', 'knowledge_base'].includes(manifest.root?.type)) fail(400, 'invalid_transfer_manifest', '迁移包根节点非法');
  if (!Array.isArray(manifest.documents) || !Array.isArray(manifest.attachments)) fail(400, 'invalid_transfer_manifest', '迁移包清单不完整');
  const docIds = new Set(manifest.documents.map((doc) => String(doc.source_id)));
  if (docIds.size !== manifest.documents.length) fail(400, 'invalid_transfer_manifest', '迁移包包含重复文档');
  for (const doc of manifest.documents) {
    if (!String(doc.source_id || '') || typeof doc.state_path !== 'string' || !/^[a-f0-9]{64}$/.test(doc.state_sha256 || '')) {
      fail(400, 'invalid_transfer_manifest', '迁移包文档清单非法');
    }
  }
  const referenced = [];
  const visitFolder = (node) => {
    if (!node || node.type !== 'folder' || !Array.isArray(node.documents) || !Array.isArray(node.folders)) {
      fail(400, 'invalid_transfer_manifest', '迁移包目录树不完整');
    }
    referenced.push(...node.documents.map(String));
    node.folders.forEach(visitFolder);
  };
  if (manifest.root.type === 'document') referenced.push(String(manifest.root.document_source_id));
  else {
    if (!Array.isArray(manifest.root.documents) || !Array.isArray(manifest.root.folders)) {
      fail(400, 'invalid_transfer_manifest', '迁移包根目录不完整');
    }
    referenced.push(...manifest.root.documents.map(String));
    manifest.root.folders.forEach(visitFolder);
  }
  const referencedSet = new Set(referenced);
  if (referencedSet.size !== referenced.length || referencedSet.size !== docIds.size
    || Array.from(docIds).some((id) => !referencedSet.has(id))) {
    fail(400, 'invalid_transfer_manifest', '迁移包文档清单与目录树不一致');
  }
  const attachmentIds = new Set();
  for (const attachment of manifest.attachments) {
    const attachmentId = String(attachment.source_id || '');
    if (!attachmentId || attachmentIds.has(attachmentId) || typeof attachment.path !== 'string'
      || !/^[a-f0-9]{64}$/.test(attachment.sha256 || '')
      || !Number.isSafeInteger(Number(attachment.size)) || Number(attachment.size) < 0) {
      fail(400, 'invalid_transfer_manifest', '迁移包附件清单非法');
    }
    attachmentIds.add(attachmentId);
    if (!docIds.has(String(attachment.document_source_id))) fail(400, 'invalid_transfer_manifest', '附件所属文档不在迁移范围内');
  }
}

function replaceAttachmentReferences(value, attachmentIds) {
  if (typeof value !== 'string') return value;
  return value.replace(/(\/(?:app-api\/v1\/|api\/v1\/)?attachments\/)([A-Za-z0-9_-]+)/g, (full, prefix, sourceId) => {
    const targetId = attachmentIds.get(sourceId);
    return targetId ? `${prefix}${targetId}` : full;
  });
}

function rewriteDocumentAttachments(node, attachmentIds) {
  if (!node || typeof node !== 'object') return false;
  let changed = false;
  if (node.attrs && typeof node.attrs === 'object') {
    for (const [key, value] of Object.entries(node.attrs)) {
      const next = replaceAttachmentReferences(value, attachmentIds);
      if (next !== value) { node.attrs[key] = next; changed = true; }
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) changed = rewriteDocumentAttachments(child, attachmentIds) || changed;
  }
  return changed;
}

function remapState(state, attachmentIds) {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, new Uint8Array(state));
  } catch {
    fail(400, 'invalid_ydoc_state', '迁移包中的文档快照损坏');
  }
  const json = yDocToProsemirrorJSON(ydoc, 'default');
  if (rewriteDocumentAttachments(json, attachmentIds)) {
    const fragment = ydoc.getXmlFragment('default');
    ydoc.transact(() => {
      fragment.delete(0, fragment.length);
      prosemirrorJSONToYXmlFragment(documentSchema, json, fragment);
    }, 'doco:native-transfer:attachments');
  }
  assertYDocChangeWithinQuota({ characters: 0, snapshotBytes: 0 }, ydocMetrics(ydoc, json));
  return Buffer.from(Y.encodeStateAsUpdate(ydoc));
}

function targetForImport(userId, manifest, body) {
  if (manifest.root.type === 'knowledge_base') return { createKnowledgeBase: true };
  const folderId = body.target_folder_id ? Number(body.target_folder_id) : null;
  const kbId = body.target_kb_id ? Number(body.target_kb_id) : null;
  if (folderId) {
    const folder = getFolderForUser(userId, folderId);
    if (!folder) fail(404, 'target_folder_not_found', '目标文件夹不存在');
    return { kbId: folder.kb_id, folderId: folder.id };
  }
  if (kbId) {
    const kb = getKnowledgeBaseForUser(userId, kbId);
    if (!kb) fail(404, 'target_knowledge_base_not_found', '目标知识库不存在');
    return { kbId: kb.id, folderId: null };
  }
  fail(400, 'transfer_target_required', '导入文档或文件夹时必须选择目标知识库或文件夹');
}

function extensionFor(filename) {
  const value = extname(String(filename || '')).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(value) ? value : '';
}

async function importPackage(userId, file, body) {
  if (!file?.buffer) fail(400, 'transfer_file_required', '请选择 Doco 迁移包');
  let zip;
  try { zip = await JSZip.loadAsync(file.buffer); }
  catch { fail(400, 'invalid_transfer_zip', '迁移包无法解压'); }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_TRANSFER_ENTRIES) fail(413, 'transfer_too_many_entries', '迁移包文件数量超过限制');
  entries.forEach((entry) => validatePath(entry.name));

  const total = { value: 0 };
  const manifestBuffer = await readEntry(zip, 'manifest.json', total);
  let manifest;
  try { manifest = JSON.parse(manifestBuffer.toString('utf8')); }
  catch { fail(400, 'invalid_transfer_manifest', '迁移包清单不是合法 JSON'); }
  validateManifest(manifest);
  if (body.expected_root_type && body.expected_root_type !== manifest.root.type) {
    fail(400, 'unexpected_transfer_scope', `这里仅支持导入${body.expected_root_type === 'document' ? '单文档' : body.expected_root_type}`);
  }
  const target = targetForImport(userId, manifest, body);

  const docIds = new Map(manifest.documents.map((doc) => [String(doc.source_id), `doc_${randomUUID()}`]));
  const attachmentIds = new Map(manifest.attachments.map((item) => [String(item.source_id), `att_${randomUUID()}`]));
  const states = new Map();
  for (const doc of manifest.documents) {
    const state = await readEntry(zip, doc.state_path, total);
    if (sha256(state) !== doc.state_sha256) fail(400, 'transfer_checksum_mismatch', `文档 ${doc.title} 校验失败`);
    states.set(String(doc.source_id), remapState(state, attachmentIds));
  }

  const attachmentFiles = [];
  for (const attachment of manifest.attachments) {
    const data = await readEntry(zip, attachment.path, total);
    if (data.length !== Number(attachment.size) || sha256(data) !== attachment.sha256) {
      fail(400, 'transfer_checksum_mismatch', `附件 ${attachment.filename} 校验失败`);
    }
    const id = attachmentIds.get(String(attachment.source_id));
    attachmentFiles.push({
      id,
      sourceDocId: String(attachment.document_source_id),
      filename: safeName(attachment.filename, 'attachment').slice(0, 255),
      mimeType: safeName(attachment.mime_type, 'application/octet-stream').slice(0, 100),
      data,
      filepath: join(attachmentDir, `${id}${extensionFor(attachment.filename)}`),
    });
  }

  const writtenFiles = [];
  try {
    for (const attachment of attachmentFiles) {
      writeFileSync(attachment.filepath, attachment.data, { flag: 'wx' });
      writtenFiles.push(attachment.filepath);
    }

    const result = db.transaction(() => {
      let kbId = target.kbId;
      let targetFolderId = target.folderId ?? null;
      if (target.createKnowledgeBase) {
        kbId = knowledgeBases.create(userId, { name: safeName(manifest.root.name, '导入的知识库') }).id;
      }

      const createdDocumentIds = [];
      const createDocument = (sourceId, folderId) => {
        const metadata = manifest.documents.find((doc) => String(doc.source_id) === String(sourceId));
        if (!metadata) fail(400, 'invalid_transfer_manifest', `目录树引用了不存在的文档 ${sourceId}`);
        const id = docIds.get(String(sourceId));
        documents.create(userId, {
          id,
          title: safeName(metadata.title, '未命名文档'),
          folder_id: folderId,
          knowledge_base_id: kbId,
          document_type: metadata.document_type,
          heading_numbered: Boolean(metadata.heading_numbered),
          background_color: metadata.background_color || '#ffffff',
          collapsed_block_ids: Array.isArray(metadata.collapsed_block_ids) ? metadata.collapsed_block_ids.map(String) : [],
        });
        db.prepare('INSERT INTO ydoc_state (doc_id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
          .run(id, states.get(String(sourceId)));
        createdDocumentIds.push(id);
      };

      const createFolder = (node, parentId) => {
        const folder = folders.create(userId, {
          name: safeName(node.name, '未命名文件夹'),
          knowledge_base_id: kbId,
          parent_id: parentId,
        });
        for (const sourceId of node.documents || []) createDocument(sourceId, folder.id);
        for (const child of node.folders || []) createFolder(child, folder.id);
        return folder.id;
      };

      let rootId;
      if (manifest.root.type === 'knowledge_base') {
        rootId = kbId;
        for (const sourceId of manifest.root.documents || []) createDocument(sourceId, null);
        for (const node of manifest.root.folders || []) createFolder(node, null);
      } else if (manifest.root.type === 'folder') {
        rootId = createFolder(manifest.root, targetFolderId);
      } else {
        createDocument(manifest.root.document_source_id, targetFolderId);
        rootId = docIds.get(String(manifest.root.document_source_id));
      }

      for (const attachment of attachmentFiles) {
        const targetDocId = docIds.get(attachment.sourceDocId);
        db.prepare('INSERT INTO attachments (id, filename, filepath, mime_type, size, doc_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(attachment.id, attachment.filename, attachment.filepath, attachment.mimeType, attachment.data.length, targetDocId);
      }
      return { root_type: manifest.root.type, root_id: rootId, knowledge_base_id: kbId, document_ids: createdDocumentIds };
    })();
    return result;
  } catch (error) {
    for (const filepath of writtenFiles) {
      try { unlinkSync(filepath); } catch {}
    }
    throw error;
  }
}

function sendError(res, error) {
  const status = error?.status || error?.statusCode || (error?.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    error: error?.code === 'LIMIT_FILE_SIZE' ? '迁移包超过大小限制' : (error?.message || '迁移失败'),
    code: error?.code,
  });
}

export function createNativeTransferRouter({ getLatestDocState }) {
  const router = Router();
  router.use(requireAuth);
  router.get('/:scope/:id/export', async (req, res) => {
    try {
      const result = await buildPackage(req.user.id, req.params.scope, req.params.id, getLatestDocState);
      res.type('application/zip');
      res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
      res.send(result.buffer);
    } catch (error) { sendError(res, error); }
  });
  router.post('/import', (req, res) => {
    upload.single('file')(req, res, async (uploadError) => {
      if (uploadError) return sendError(res, uploadError);
      try { res.status(201).json(await importPackage(req.user.id, req.file, req.body || {})); }
      catch (error) { sendError(res, error); }
    });
  });
  return router;
}
