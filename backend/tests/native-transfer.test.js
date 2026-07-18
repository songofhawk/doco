import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from 'y-prosemirror';

const tempDir = mkdtempSync(join(tmpdir(), 'doco-native-transfer-test-'));
process.env.DOCO_DB_PATH = join(tempDir, 'test.db');
process.env.DOCO_ATTACHMENTS_PATH = join(tempDir, 'attachments');

let app;
let db;
let cookie;
let sourceKbId;
let documentSchema;

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function exportPackage(request, path) {
  return request(app).get(path).set('Cookie', cookie).buffer(true).parse(binaryParser).expect(200);
}

before(async () => {
  ({ db } = await import('../database.js'));
  const auth = await import('../auth.js');
  ({ documentSchema } = await import('../document-schema.js'));
  ({ app } = await import('../server.js'));

  const now = Date.now();
  db.prepare(`
    INSERT INTO users (id, email, normalized_email, email_verified_at, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('transfer-user', 'transfer@example.com', 'transfer@example.com', now, 'Transfer', now, now);
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)').run('transfer-workspace', 'Transfer', 'transfer-user', now, now);
  db.prepare('INSERT INTO workspace_members VALUES (?, ?, ?, ?)').run('transfer-workspace', 'transfer-user', 'owner', now);
  sourceKbId = db.prepare('INSERT INTO knowledge_bases (name, workspace_id) VALUES (?, ?)')
    .run('原生迁移知识库', 'transfer-workspace').lastInsertRowid;
  const folderId = db.prepare('INSERT INTO folders (name, kb_id) VALUES (?, ?)').run('一级文件夹', sourceKbId).lastInsertRowid;
  const childFolderId = db.prepare('INSERT INTO folders (name, kb_id, parent_id) VALUES (?, ?, ?)')
    .run('二级文件夹', sourceKbId, folderId).lastInsertRowid;

  db.prepare(`
    INSERT INTO documents (id, title, folder_id, document_type, heading_numbered, bg_color, collapsed_blocks)
    VALUES (?, ?, ?, 'document', 1, '#f5efe3', ?)
  `).run('source-doc', '带图片文档', childFolderId, 'block_a,block_b');
  const ydoc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(documentSchema, {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: 'block_a' }, content: [{ type: 'text', text: '原生迁移正文' }] },
      { type: 'image', attrs: { src: '/app-api/v1/attachments/att_source', alt: '测试图片' } },
    ],
  }, ydoc.getXmlFragment('default'));
  db.prepare('INSERT INTO ydoc_state (doc_id, state) VALUES (?, ?)').run('source-doc', Buffer.from(Y.encodeStateAsUpdate(ydoc)));

  db.prepare(`
    INSERT INTO documents (id, title, kb_id, document_type)
    VALUES (?, ?, ?, 'spreadsheet')
  `).run('source-sheet', '原生电子表格', sourceKbId);
  const sheet = new Y.Doc();
  sheet.getMap('spreadsheet').set('data', { version: 1, rows: 2, cols: 2, cells: { A1: '完整保留' }, styles: {}, colWidths: {}, merges: [], frozenRows: 1, frozenCols: 0, filters: {} });
  db.prepare('INSERT INTO ydoc_state (doc_id, state) VALUES (?, ?)').run('source-sheet', Buffer.from(Y.encodeStateAsUpdate(sheet)));

  const attachmentPath = join(process.env.DOCO_ATTACHMENTS_PATH, 'source.png');
  mkdirSync(process.env.DOCO_ATTACHMENTS_PATH, { recursive: true });
  writeFileSync(attachmentPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  db.prepare('INSERT INTO attachments (id, filename, filepath, mime_type, size, doc_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('att_source', '测试图片.png', attachmentPath, 'image/png', 4, 'source-doc');
  cookie = `doco_session=${auth.createSession('transfer-user').token}`;
});

after(() => {
  try { db.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
});

test('知识库原生包完整迁移目录、Yjs、设置、电子表格和附件', async () => {
  const request = (await import('supertest')).default;
  const exported = await exportPackage(request, `/app-api/v1/native-transfer/knowledge-base/${sourceKbId}/export`);
  assert.match(exported.headers['content-disposition'], /\.doco\.zip/);

  const zip = await JSZip.loadAsync(exported.body);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.format, 'doco-native-transfer');
  assert.equal(manifest.documents.length, 2);
  assert.equal(manifest.attachments.length, 1);

  const imported = await request(app)
    .post('/app-api/v1/native-transfer/import')
    .set('Cookie', cookie)
    .attach('file', exported.body, { filename: 'backup.doco.zip', contentType: 'application/zip' })
    .expect(201);
  assert.equal(imported.body.root_type, 'knowledge_base');
  assert.notEqual(Number(imported.body.root_id), Number(sourceKbId));
  assert.equal(imported.body.document_ids.length, 2);

  const importedKb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(imported.body.root_id);
  assert.equal(importedKb.name, '原生迁移知识库');
  const rootFolder = db.prepare('SELECT * FROM folders WHERE kb_id = ? AND parent_id IS NULL').get(importedKb.id);
  const childFolder = db.prepare('SELECT * FROM folders WHERE kb_id = ? AND parent_id = ?').get(importedKb.id, rootFolder.id);
  assert.equal(rootFolder.name, '一级文件夹');
  assert.equal(childFolder.name, '二级文件夹');

  const importedDoc = db.prepare('SELECT * FROM documents WHERE folder_id = ?').get(childFolder.id);
  assert.notEqual(importedDoc.id, 'source-doc');
  assert.equal(importedDoc.heading_numbered, 1);
  assert.equal(importedDoc.bg_color, '#f5efe3');
  assert.equal(importedDoc.collapsed_blocks, 'block_a,block_b');
  const importedState = db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?').get(importedDoc.id).state;
  const importedYDoc = new Y.Doc();
  Y.applyUpdate(importedYDoc, new Uint8Array(importedState));
  const json = yDocToProsemirrorJSON(importedYDoc, 'default');
  assert.equal(json.content[0].content[0].text, '原生迁移正文');
  const importedAttachment = db.prepare('SELECT * FROM attachments WHERE doc_id = ?').get(importedDoc.id);
  assert.notEqual(importedAttachment.id, 'att_source');
  assert.match(json.content[1].attrs.src, new RegExp(`/attachments/${importedAttachment.id}$`));
  assert.deepEqual(readFileSync(importedAttachment.filepath), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const importedSheet = db.prepare("SELECT * FROM documents WHERE kb_id = ? AND document_type = 'spreadsheet'").get(importedKb.id);
  const sheetState = db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?').get(importedSheet.id).state;
  const sheetYDoc = new Y.Doc();
  Y.applyUpdate(sheetYDoc, new Uint8Array(sheetState));
  assert.equal(sheetYDoc.getMap('spreadsheet').get('data').cells.A1, '完整保留');
});

test('文件夹和单文档原生包按所选目标导入，缺少目标时拒绝', async () => {
  const request = (await import('supertest')).default;
  const sourceFolder = db.prepare('SELECT * FROM folders WHERE kb_id = ? AND name = ?').get(sourceKbId, '一级文件夹');
  const folderPackage = await exportPackage(request, `/app-api/v1/native-transfer/folder/${sourceFolder.id}/export`);

  await request(app)
    .post('/app-api/v1/native-transfer/import')
    .set('Cookie', cookie)
    .attach('file', folderPackage.body, { filename: 'folder.doco.zip', contentType: 'application/zip' })
    .expect(400);

  await request(app)
    .post('/app-api/v1/native-transfer/import')
    .set('Cookie', cookie)
    .field('expected_root_type', 'document')
    .field('target_kb_id', String(sourceKbId))
    .attach('file', folderPackage.body, { filename: 'folder.doco.zip', contentType: 'application/zip' })
    .expect(400);

  const importedFolder = await request(app)
    .post('/app-api/v1/native-transfer/import')
    .set('Cookie', cookie)
    .field('target_kb_id', String(sourceKbId))
    .attach('file', folderPackage.body, { filename: 'folder.doco.zip', contentType: 'application/zip' })
    .expect(201);
  assert.equal(importedFolder.body.root_type, 'folder');
  const folderCopy = db.prepare('SELECT * FROM folders WHERE id = ?').get(importedFolder.body.root_id);
  assert.equal(folderCopy.kb_id, Number(sourceKbId));
  assert.equal(folderCopy.parent_id, null);
  assert.equal(folderCopy.name, '一级文件夹');
  const childCopy = db.prepare('SELECT * FROM folders WHERE parent_id = ?').get(folderCopy.id);
  assert.equal(childCopy.name, '二级文件夹');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM documents WHERE folder_id = ?').get(childCopy.id).count, 1);

  const documentPackage = await exportPackage(request, '/app-api/v1/native-transfer/document/source-doc/export');
  const importedDocument = await request(app)
    .post('/app-api/v1/native-transfer/import')
    .set('Cookie', cookie)
    .field('target_folder_id', String(sourceFolder.id))
    .attach('file', documentPackage.body, { filename: 'document.doco.zip', contentType: 'application/zip' })
    .expect(201);
  assert.equal(importedDocument.body.root_type, 'document');
  const documentCopy = db.prepare('SELECT * FROM documents WHERE id = ?').get(importedDocument.body.root_id);
  assert.equal(documentCopy.folder_id, sourceFolder.id);
  assert.equal(documentCopy.title, '带图片文档');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE doc_id = ?').get(documentCopy.id).count, 1);
});
