import { createHash } from 'crypto';
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from 'y-prosemirror';
import { db, hasLegacyUpdatesTable } from './database.js';
import { getDocumentForUser } from './permissions.js';
import { documentSchema, normalizeAndValidateDocument } from './document-schema.js';
import { ApiError } from './open-api/errors.js';
import { assertYDocChangeWithinQuota, ydocMetrics } from './quota.js';

const selectState = db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?');
const upsertState = db.prepare(`
  INSERT INTO ydoc_state (doc_id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(doc_id) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
`);

let hocuspocusInstance = null;
const queues = new Map();

export function registerHocuspocus(instance) {
  hocuspocusInstance = instance;
}

export function loadLegacyState(documentId) {
  if (!hasLegacyUpdatesTable) return null;
  const rows = db.prepare('SELECT [update] FROM ydoc_updates WHERE doc_id = ? ORDER BY id').all(documentId);
  if (!rows.length) return null;
  return Y.mergeUpdates(rows.map((row) => new Uint8Array(row.update)));
}

export function persistYDoc(documentId, ydoc) {
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  upsertState.run(documentId, state);
  db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(Date.now(), documentId);
  return state;
}

export function documentVersion(ydoc) {
  return `sha256:${createHash('sha256').update(Y.encodeStateAsUpdate(ydoc)).digest('hex')}`;
}

export function quoteEtag(version) { return `"${version}"`; }
export function parseIfMatch(value) { return value ? String(value).trim().replace(/^W\//, '').replace(/^"|"$/g, '') : null; }

function currentJson(ydoc) {
  const json = yDocToProsemirrorJSON(ydoc, 'default');
  return json?.type === 'doc' ? json : { type: 'doc', content: [] };
}

function setJson(ydoc, json) {
  const fragment = ydoc.getXmlFragment('default');
  prosemirrorJSONToYXmlFragment(documentSchema, json, fragment);
}

export function assertYDocsWithinQuota(beforeYDoc, afterYDoc) {
  assertYDocChangeWithinQuota(
    ydocMetrics(beforeYDoc, currentJson(beforeYDoc)),
    ydocMetrics(afterYDoc, currentJson(afterYDoc)),
  );
}

export function defaultSpreadsheetData() {
  return {
    version: 1, rows: 30, cols: 12, cells: {}, styles: {}, colWidths: {},
    merges: [], frozenRows: 0, frozenCols: 0, filters: {},
  };
}

export function initializeStandaloneSpreadsheet(documentId, data = defaultSpreadsheetData()) {
  const ydoc = new Y.Doc();
  ydoc.getMap('spreadsheet').set('data', data);
  persistYDoc(documentId, ydoc);
  return ydoc;
}

export function migrateStandaloneSpreadsheet(ydoc, documentId) {
  const doc = db.prepare('SELECT document_type FROM documents WHERE id = ?').get(documentId);
  if (doc?.document_type !== 'spreadsheet') return false;
  const sheetMap = ydoc.getMap('spreadsheet');
  if (sheetMap.has('data')) return false;
  const legacy = currentJson(ydoc);
  const block = legacy.content?.find((node) => node.type === 'spreadsheetBlock');
  ydoc.transact(() => {
    sheetMap.set('data', block?.attrs?.data || defaultSpreadsheetData());
    setJson(ydoc, { type: 'doc', content: [] });
  }, 'doco:migrate-standalone-spreadsheet');
  return true;
}

async function serialized(documentId, operation) {
  const previous = queues.get(documentId) || Promise.resolve();
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => barrier);
  queues.set(documentId, queued);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (queues.get(documentId) === queued) queues.delete(documentId);
  }
}

export class YDocService {
  loadRaw(documentId) {
    const live = hocuspocusInstance?.documents?.get(documentId);
    if (live) return { ydoc: live, online: true };
    const ydoc = new Y.Doc();
    let state = selectState.get(documentId)?.state || null;
    if (!state) {
      state = loadLegacyState(documentId);
      if (state) upsertState.run(documentId, Buffer.from(state));
    }
    if (state) Y.applyUpdate(ydoc, new Uint8Array(state));
    return { ydoc, online: false };
  }

  async loadLatest(documentId, user) {
    const doc = getDocumentForUser(user.id, documentId);
    if (!doc) throw new ApiError(404, 'document_not_found', '文档不存在');
    return serialized(documentId, async () => {
      const loaded = this.loadRaw(documentId);
      const normalized = normalizeAndValidateDocument(currentJson(loaded.ydoc));
      if (normalized.changed) {
        loaded.ydoc.transact(() => setJson(loaded.ydoc, normalized.document), 'doco:block-id-migration');
        persistYDoc(documentId, loaded.ydoc);
      }
      return {
        ...loaded,
        metadata: doc,
        document: normalized.document,
        version: documentVersion(loaded.ydoc),
      };
    });
  }

  async transact(documentId, user, callback, options = {}) {
    const doc = getDocumentForUser(user.id, documentId);
    if (!doc) throw new ApiError(404, 'document_not_found', '文档不存在');
    return serialized(documentId, async () => {
      const loaded = this.loadRaw(documentId);
      const before = normalizeAndValidateDocument(currentJson(loaded.ydoc));
      if (before.changed) {
        loaded.ydoc.transact(() => setJson(loaded.ydoc, before.document), 'doco:block-id-migration');
      }
      const currentVersion = documentVersion(loaded.ydoc);
      if (options.requireMatch && !options.ifMatch) {
        throw new ApiError(428, 'precondition_required', '已有正文必须提供 If-Match');
      }
      if (options.ifMatch && parseIfMatch(options.ifMatch) !== currentVersion) {
        throw new ApiError(409, 'document_version_conflict', '文档已被其他调用方修改', { current_version: currentVersion });
      }
      const candidate = await callback(structuredClone(before.document), currentVersion);
      const normalized = normalizeAndValidateDocument(candidate);
      const candidateYDoc = new Y.Doc();
      try {
        Y.applyUpdate(candidateYDoc, Y.encodeStateAsUpdate(loaded.ydoc));
        candidateYDoc.transact(() => setJson(candidateYDoc, normalized.document), options.origin || 'doco:open-api:validate');
        assertYDocsWithinQuota(loaded.ydoc, candidateYDoc);
      } finally {
        candidateYDoc.destroy();
      }
      loaded.ydoc.transact(() => setJson(loaded.ydoc, normalized.document), options.origin || 'doco:open-api');
      persistYDoc(documentId, loaded.ydoc);
      return {
        ...loaded,
        metadata: doc,
        document: normalized.document,
        version: documentVersion(loaded.ydoc),
      };
    });
  }
}

export const yDocService = new YDocService();
