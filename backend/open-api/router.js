import { Router } from 'express';
import { mkdirSync, unlinkSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { ulid } from 'ulid';
import JSZip from 'jszip';
import { db } from '../database.js';
import { authenticateBearer, requireScopes } from './tokens.js';
import { ApiError, asyncRoute, sendData } from './errors.js';
import { authenticatedRateLimits, consumeLimit, limits } from './rate-limit.js';
import { idempotent } from './idempotency.js';
import { audit } from './audit.js';
import { documents, folders, knowledgeBases } from '../resource-service.js';
import { yDocService, quoteEtag } from '../ydoc-service.js';
import {
  collectAttachmentIds, documentToHtml, findNodeById, htmlToDocument,
  markdownToDocument, normalizeAndValidateDocument,
} from '../document-schema.js';
import { documentToMarkdown, markdownWarnings } from '../markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const attachmentDir = resolve(process.env.DOCO_ATTACHMENTS_PATH || join(__dirname, '..', 'attachments'));
mkdirSync(attachmentDir, { recursive: true });
const maxAttachmentBytes = Number(process.env.OPEN_API_MAX_ATTACHMENT_BYTES || 20 * 1024 * 1024);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxAttachmentBytes, files: 1 } });
const allowedMimes = new Set((process.env.OPEN_API_ATTACHMENT_MIME_TYPES ||
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  .split(',').map((value) => value.trim()));

export const openApi = Router();
openApi.use((req, res, next) => {
  const token = authenticateBearer(req.get('authorization'));
  if (!token) {
    try { consumeLimit(req, res, `unauth:${req.ip}`, limits.unauthenticated()); }
    catch (error) { return next(error); }
    audit('api_token.authentication_failed', req);
    return next(new ApiError(401, 'invalid_api_token', 'Bearer Token 缺失、非法、过期或已撤销'));
  }
  req.apiToken = token;
  req.user = { id: token.user_id, email: token.email, name: token.user_name, avatarUrl: token.avatar_url };
  next();
});
openApi.use(authenticatedRateLimits);

openApi.get('/me', (req, res) => sendData(res, { user: req.user, scopes: req.apiToken.scopes, token_id: req.apiToken.id }));

openApi.get('/knowledge-bases', requireScopes('knowledge-bases:read'), (req, res) => {
  sendData(res, knowledgeBases.list(req.user.id), { page: { cursor: null, next_cursor: null, has_more: false } });
});
openApi.post('/knowledge-bases', requireScopes('knowledge-bases:write'), idempotent((req, res) => {
  res.status(201); sendData(res, knowledgeBases.create(req.user.id, req.body));
}));
openApi.get('/knowledge-bases/:id', requireScopes('knowledge-bases:read'), (req, res) => sendData(res, knowledgeBases.get(req.user.id, req.params.id)));
openApi.patch('/knowledge-bases/:id', requireScopes('knowledge-bases:write'), (req, res) => sendData(res, knowledgeBases.update(req.user.id, req.params.id, req.body)));
openApi.delete('/knowledge-bases/:id', requireScopes('knowledge-bases:write'), (req, res, next) => {
  if (String(req.body?.confirm_id) !== String(req.params.id)) return next(new ApiError(400, 'confirmation_required', 'confirm_id 必须与知识库 ID 一致'));
  knowledgeBases.remove(req.user.id, req.params.id);
  audit('knowledge_base.deleted', req, { resourceType: 'knowledge_base', resourceId: req.params.id });
  res.status(204).end();
});
openApi.get('/knowledge-bases/:id/tree', requireScopes('knowledge-bases:read'), (req, res) => sendData(res, knowledgeBases.tree(req.user.id, req.params.id)));
openApi.get('/knowledge-bases/:id/export', requireScopes('knowledge-bases:read', 'documents:read'), asyncRoute(async (req, res) => {
  const tree = knowledgeBases.tree(req.user.id, req.params.id);
  const zip = new JSZip();
  const used = new Set();
  const clean = (name) => String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
  const addDoc = async (doc, prefix) => {
    const loaded = await yDocService.loadLatest(doc.id, req.user);
    let filename = `${prefix}${clean(doc.title)}.md`;
    for (let index = 2; used.has(filename); index++) filename = `${prefix}${clean(doc.title)}-${index}.md`;
    used.add(filename); zip.file(filename, documentToMarkdown(loaded.document));
  };
  const walk = async (node, prefix) => {
    for (const doc of node.documents) await addDoc(doc, prefix);
    for (const folder of node.folders) await walk(folder, `${prefix}${clean(folder.name)}/`);
  };
  await walk(tree, '');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  res.type('application/zip').attachment(`${clean(tree.name)}.zip`).send(buffer);
}));

openApi.get('/folders/:id', requireScopes('knowledge-bases:read'), (req, res) => sendData(res, folders.get(req.user.id, req.params.id)));
openApi.post('/folders', requireScopes('knowledge-bases:write'), idempotent((req, res) => { res.status(201); sendData(res, folders.create(req.user.id, req.body)); }));
openApi.patch('/folders/:id', requireScopes('knowledge-bases:write'), (req, res) => sendData(res, folders.update(req.user.id, req.params.id, req.body)));
openApi.delete('/folders/:id', requireScopes('knowledge-bases:write'), (req, res) => { folders.remove(req.user.id, req.params.id); res.status(204).end(); });
openApi.get('/folders/:id/children', requireScopes('knowledge-bases:read', 'documents:read'), (req, res) => sendData(res, folders.children(req.user.id, req.params.id)));

openApi.get('/documents', requireScopes('documents:read'), (req, res) => {
  const result = documents.list(req.user.id, req.query); sendData(res, result.data, { page: result.page });
});
openApi.post('/documents', requireScopes('documents:write'), idempotent(asyncRoute(async (req, res) => {
  const doc = documents.create(req.user.id, req.body);
  try {
    if (req.body?.content) {
      const initial = parseContentInput(req.body.content);
      canonicalizeAttachmentImages(req.user.id, doc.id, initial);
      await yDocService.transact(doc.id, req.user, () => initial, { origin: 'doco:open-api:create' });
    }
  } catch (error) { documents.remove(req.user.id, doc.id); throw error; }
  res.status(201); sendData(res, doc);
})));
openApi.get('/documents/:id', requireScopes('documents:read'), (req, res) => sendData(res, documents.get(req.user.id, req.params.id)));
openApi.patch('/documents/:id', requireScopes('documents:write'), (req, res) => sendData(res, documents.update(req.user.id, req.params.id, req.body)));
openApi.delete('/documents/:id', requireScopes('documents:write'), (req, res) => { documents.remove(req.user.id, req.params.id); res.status(204).end(); });
openApi.get('/documents/:id/path', requireScopes('documents:read'), (req, res) => sendData(res, documents.path(req.user.id, req.params.id)));

openApi.get('/documents/:id/content', requireScopes('documents:read'), asyncRoute(async (req, res) => {
  const loaded = await yDocService.loadLatest(req.params.id, req.user);
  const format = req.query.format || 'tiptap-json';
  const result = formatContent(loaded.document, format);
  res.set('ETag', quoteEtag(loaded.version));
  sendData(res, { document_id: req.params.id, format, version: loaded.version, ...result });
}));

openApi.put('/documents/:id/content', requireScopes('documents:write'), asyncRoute(async (req, res) => {
  const input = parseContentInput(req.body);
  canonicalizeAttachmentImages(req.user.id, req.params.id, input);
  const loaded = await yDocService.transact(req.params.id, req.user, () => input, {
    requireMatch: true, ifMatch: req.get('if-match'), origin: 'doco:open-api:replace',
  });
  res.set('ETag', quoteEtag(loaded.version));
  sendData(res, { document_id: req.params.id, version: loaded.version, warnings: [] });
}));

openApi.get('/documents/:id/blocks', requireScopes('documents:read'), asyncRoute(async (req, res) => {
  const loaded = await yDocService.loadLatest(req.params.id, req.user);
  const recursive = req.query.recursive === 'true';
  const blocks = recursive ? flattenBlocks(loaded.document) : (loaded.document.content || []);
  res.set('ETag', quoteEtag(loaded.version));
  sendData(res, { document_id: req.params.id, version: loaded.version, blocks });
}));
openApi.get('/documents/:id/blocks/:blockId', requireScopes('documents:read'), asyncRoute(async (req, res) => {
  const loaded = await yDocService.loadLatest(req.params.id, req.user);
  const found = findNodeById(loaded.document, req.params.blockId);
  if (!found) throw new ApiError(404, 'block_not_found', '块不存在');
  res.set('ETag', quoteEtag(loaded.version)); sendData(res, { version: loaded.version, block: found.node });
}));
openApi.post('/documents/:id/blocks', requireScopes('documents:write'), asyncRoute(async (req, res) => {
  const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
  if (!nodes.length) throw new ApiError(400, 'nodes_required', 'nodes 不能为空');
  const loaded = await yDocService.transact(req.params.id, req.user, (document) => {
    insertNodes(document, req.body.position, nodes); return document;
  }, { ifMatch: req.get('if-match'), origin: 'doco:open-api:blocks-insert' });
  res.status(201).set('ETag', quoteEtag(loaded.version)); sendData(res, { version: loaded.version, blocks: loaded.document.content });
}));
openApi.patch('/documents/:id/blocks/:blockId', requireScopes('documents:write'), asyncRoute(async (req, res) => {
  const loaded = await yDocService.transact(req.params.id, req.user, (document) => {
    const found = findNodeById(document, req.params.blockId);
    if (!found || !found.parent) throw new ApiError(404, 'block_not_found', '块不存在');
    const replacement = req.body.node ? structuredClone(req.body.node) : { ...found.node, attrs: { ...found.node.attrs, ...(req.body.attrs || {}) } };
    if (req.body.content !== undefined) replacement.content = req.body.content;
    replacement.attrs ||= {}; replacement.attrs.id = req.params.blockId;
    found.parent.content[found.index] = replacement; return document;
  }, { ifMatch: req.get('if-match'), origin: 'doco:open-api:block-update' });
  const block = findNodeById(loaded.document, req.params.blockId).node;
  res.set('ETag', quoteEtag(loaded.version)); sendData(res, { version: loaded.version, block });
}));
openApi.delete('/documents/:id/blocks/:blockId', requireScopes('documents:write'), asyncRoute(async (req, res) => {
  const loaded = await yDocService.transact(req.params.id, req.user, (document) => {
    deleteBlock(document, req.params.blockId); return document;
  }, { ifMatch: req.get('if-match'), origin: 'doco:open-api:block-delete' });
  res.set('ETag', quoteEtag(loaded.version)); sendData(res, { version: loaded.version });
}));
openApi.post('/documents/:id/batch', requireScopes('documents:write'), idempotent(asyncRoute(async (req, res) => {
  const operations = req.body?.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new ApiError(400, 'invalid_operations', 'operations 数量必须为 1 到 100');
  const loaded = await yDocService.transact(req.params.id, req.user, (document) => {
    for (const operation of operations) applyOperation(document, operation);
    return document;
  }, { ifMatch: req.body.base_version || req.get('if-match'), origin: 'doco:open-api:batch' });
  res.set('ETag', quoteEtag(loaded.version)); sendData(res, { version: loaded.version, operation_count: operations.length });
})));

openApi.post('/attachments', requireScopes('attachments:write'), upload.single('file'), idempotent(asyncRoute(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'file_required', '必须上传 file 字段');
  const documentId = String(req.body?.document_id || '');
  documents.get(req.user.id, documentId);
  if (!allowedMimes.has(req.file.mimetype)) throw new ApiError(415, 'unsupported_attachment_type', '不支持的附件 MIME 类型');
  const detected = await fileTypeFromBuffer(req.file.buffer);
  if (detected && detected.mime !== req.file.mimetype && !(req.file.mimetype === 'image/jpeg' && detected.mime === 'image/jpeg')) {
    throw new ApiError(415, 'attachment_signature_mismatch', '附件内容与 MIME 类型不一致');
  }
  const id = `att_${ulid()}`;
  const suffix = detected?.ext || extname(req.file.originalname).slice(1).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const filepath = join(attachmentDir, `${id}.${suffix}`);
  await import('fs/promises').then(({ writeFile }) => writeFile(filepath, req.file.buffer, { flag: 'wx' }));
  db.prepare('INSERT INTO attachments (id, filename, filepath, mime_type, size, doc_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.file.originalname.slice(0, 255), filepath, req.file.mimetype, req.file.size, documentId);
  res.status(201); sendData(res, attachmentMetadata(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id)));
})));
openApi.get('/attachments/:id/metadata', requireScopes('attachments:read'), (req, res) => sendData(res, ownedAttachment(req.user.id, req.params.id)));
openApi.get('/attachments/:id', requireScopes('attachments:read'), (req, res) => {
  const attachment = ownedAttachment(req.user.id, req.params.id);
  res.type(attachment.mime_type).set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`).sendFile(attachment.filepath);
});
openApi.delete('/attachments/:id', requireScopes('attachments:write', 'documents:write'), asyncRoute(async (req, res) => {
  const attachment = ownedAttachment(req.user.id, req.params.id);
  const loaded = await yDocService.loadLatest(attachment.document_id, req.user);
  const referenced = collectAttachmentIds(loaded.document).has(attachment.id);
  if (referenced && req.query.force !== 'true') throw new ApiError(409, 'attachment_in_use', '附件仍被文档引用');
  if (referenced) {
    await yDocService.transact(attachment.document_id, req.user, (document) => {
      removeAttachmentImages(document, attachment.id); return document;
    }, { origin: 'doco:open-api:attachment-force-delete' });
  }
  db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
  try { unlinkSync(attachment.filepath); } catch {}
  res.status(204).end();
}));

function parseContentInput(body) {
  const format = body?.format || 'tiptap-json';
  if (format === 'tiptap-json') return normalizeAndValidateDocument(body.document).document;
  if (format === 'markdown') return markdownToDocument(String(body.content ?? body.markdown ?? ''));
  if (format === 'html') return htmlToDocument(String(body.content ?? body.html ?? ''));
  throw new ApiError(415, 'unsupported_content_format', 'format 仅支持 tiptap-json、markdown、html');
}

function formatContent(document, format) {
  if (format === 'tiptap-json') return { document, warnings: [] };
  if (format === 'markdown') return { content: documentToMarkdown(document), warnings: markdownWarnings(document) };
  if (format === 'html') return { content: documentToHtml(document), warnings: [] };
  throw new ApiError(415, 'unsupported_content_format', 'format 仅支持 tiptap-json、markdown、html');
}

function canonicalizeAttachmentImages(userId, documentId, document) {
  const visit = (node) => {
    if (node.type === 'image' && node.attrs?.attachmentId) {
      const attachment = db.prepare(`
        SELECT a.id FROM attachments a JOIN documents d ON d.id = a.doc_id
        LEFT JOIN folders f ON f.id = d.folder_id JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id)
        JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
        WHERE a.id = ? AND a.doc_id = ? AND wm.user_id = ?
      `).get(node.attrs.attachmentId, documentId, userId);
      if (!attachment) throw new ApiError(422, 'invalid_attachment_reference', '图片引用的附件不存在或不属于当前文档');
      node.attrs.src = `/api/v1/attachments/${attachment.id}`;
    }
    node.content?.forEach(visit);
  };
  visit(document);
}

function flattenBlocks(document) {
  const result = [];
  const visit = (node) => { if (node !== document && node.attrs?.id) result.push(node); node.content?.forEach(visit); };
  visit(document); return result;
}

function insertNodes(document, position, nodes) {
  const choices = ['after_block_id', 'before_block_id', 'parent_block_id', 'document_start', 'document_end']
    .filter((key) => position?.[key] !== undefined && position[key] !== false);
  if (choices.length !== 1) throw new ApiError(400, 'invalid_position', 'position 必须且只能指定一种定位方式');
  const copies = structuredClone(nodes);
  if (choices[0] === 'document_start') return document.content.splice(0, 0, ...copies);
  if (choices[0] === 'document_end') return document.content.push(...copies);
  if (choices[0] === 'parent_block_id') {
    const parent = findNodeById(document, position.parent_block_id)?.node;
    if (!parent) throw new ApiError(404, 'block_not_found', '父块不存在');
    parent.content ||= [];
    const index = position.child_index == null ? parent.content.length : Number(position.child_index);
    if (!Number.isInteger(index) || index < 0 || index > parent.content.length) throw new ApiError(400, 'invalid_child_index', 'child_index 非法');
    return parent.content.splice(index, 0, ...copies);
  }
  const id = position[choices[0]];
  const found = findNodeById(document, id);
  if (!found?.parent) throw new ApiError(404, 'block_not_found', '锚点块不存在');
  found.parent.content.splice(found.index + (choices[0] === 'after_block_id' ? 1 : 0), 0, ...copies);
}

function deleteBlock(document, id) {
  const found = findNodeById(document, id);
  if (!found?.parent) throw new ApiError(404, 'block_not_found', '块不存在');
  found.parent.content.splice(found.index, 1);
}

function applyOperation(document, operation) {
  if (operation.op === 'delete') return deleteBlock(document, operation.block_id);
  if (operation.op === 'insert') {
    const positionKey = ['after_block_id', 'before_block_id', 'parent_block_id', 'document_start', 'document_end'].find((key) => operation[key] !== undefined);
    const position = positionKey ? { [positionKey]: operation[positionKey], child_index: operation.child_index } : operation.position;
    return insertNodes(document, position, operation.nodes || []);
  }
  if (operation.op === 'replace') {
    const found = findNodeById(document, operation.block_id);
    if (!found?.parent || !operation.node) throw new ApiError(404, 'block_not_found', '块不存在或替换节点缺失');
    const node = structuredClone(operation.node); node.attrs ||= {}; node.attrs.id = operation.block_id;
    found.parent.content[found.index] = node; return;
  }
  throw new ApiError(400, 'unsupported_batch_operation', `不支持的批量操作: ${operation.op}`);
}

function attachmentMetadata(row) {
  return { id: row.id, filename: row.filename, mime_type: row.mime_type, size: row.size, document_id: row.doc_id, created_at: row.created_at, url: `/api/v1/attachments/${row.id}` };
}
function ownedAttachment(userId, id) {
  const row = db.prepare(`
    SELECT a.* FROM attachments a JOIN documents d ON d.id = a.doc_id LEFT JOIN folders f ON f.id = d.folder_id
    JOIN knowledge_bases kb ON kb.id = COALESCE(d.kb_id, f.kb_id) JOIN workspace_members wm ON wm.workspace_id = kb.workspace_id
    WHERE a.id = ? AND wm.user_id = ?
  `).get(id, userId);
  if (!row) throw new ApiError(404, 'attachment_not_found', '附件不存在');
  return { ...attachmentMetadata(row), filepath: row.filepath };
}
function removeAttachmentImages(node, id) {
  if (!node.content) return;
  node.content = node.content.filter((child) => !(child.type === 'image' && child.attrs?.attachmentId === id));
  node.content.forEach((child) => removeAttachmentImages(child, id));
}
