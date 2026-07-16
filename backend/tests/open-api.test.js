import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDir = mkdtempSync(join(tmpdir(), 'doco-open-api-test-'));
process.env.DOCO_DB_PATH = join(tempDir, 'test.db');
process.env.DOCO_ATTACHMENTS_PATH = join(tempDir, 'attachments');
process.env.OPEN_API_RATE_LIMIT_PER_MINUTE = '10000';
process.env.OPEN_API_WRITE_RATE_LIMIT_PER_MINUTE = '10000';
process.env.OPEN_API_DOCUMENT_WRITE_RATE_LIMIT_PER_MINUTE = '10000';

let request;
let app;
let db;
let createApiToken;
let createSession;
let token1;
let token2;
let cookie1;

function seedUser(id, googleSub, email) {
  const now = Date.now();
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, googleSub, email, id, null, now, now);
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)').run(`workspace-${id}`, `${id} workspace`, id, now, now);
  db.prepare('INSERT INTO workspace_members VALUES (?, ?, ?, ?)').run(`workspace-${id}`, id, 'owner', now);
}

before(async () => {
  ({ default: request } = await import('supertest'));
  ({ db } = await import('../database.js'));
  ({ createApiToken } = await import('../open-api/tokens.js'));
  ({ createSession } = await import('../auth.js'));
  ({ app } = await import('../server.js'));
  seedUser('user-1', 'google-1', 'one@example.com');
  seedUser('user-2', 'google-2', 'two@example.com');
  token1 = createApiToken('user-1', { name: 'test-rw', access: 'read_write' }).token;
  token2 = createApiToken('user-2', { name: 'test-rw', access: 'read_write' }).token;
  cookie1 = `doco_session=${createSession('user-1').token}`;
});

after(() => {
  try { db.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
});

test('页面 Cookie 与开放 Bearer 严格隔离', async () => {
  await request(app).get('/app-api/v1/kb').set('Authorization', `Bearer ${token1}`).expect(401);
  await request(app).get('/api/v1/me').set('Cookie', cookie1).expect(401);
  const page = await request(app).get('/app-api/v1/kb').set('Cookie', cookie1).expect(200);
  assert.deepEqual(page.body, []);
  const open = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token1}`).expect(200);
  assert.equal(open.body.data.user.id, 'user-1');
});

test('Token 仅哈希存储且撤销立即生效', async () => {
  const created = createApiToken('user-1', { name: 'revoke-me', access: 'read_only' });
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(created.id);
  assert.equal(row.secret_hash.length, 64);
  assert.equal(JSON.stringify(row).includes(created.token), false);
  await request(app).get('/api/v1/me').set('Authorization', `Bearer ${created.token}`).expect(200);
  await request(app).delete(`/app-api/v1/api-tokens/${created.id}`).set('Cookie', cookie1).expect(204);
  await request(app).get('/api/v1/me').set('Authorization', `Bearer ${created.token}`).expect(401);
});

test('旧文档块 ID 懒迁移幂等并立即持久化', async () => {
  const { documentSchema } = await import('../document-schema.js');
  const { yDocService } = await import('../ydoc-service.js');
  const { prosemirrorJSONToYDoc } = await import('y-prosemirror');
  const Y = await import('yjs');
  const kb = db.prepare('INSERT INTO knowledge_bases (name, workspace_id) VALUES (?, ?)').run('Legacy', 'workspace-user-1').lastInsertRowid;
  db.prepare('INSERT INTO documents (id, title, kb_id) VALUES (?, ?, ?)').run('legacy-block-doc', 'Legacy', kb);
  const oldDoc = prosemirrorJSONToYDoc(documentSchema, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] }, 'default');
  db.prepare('INSERT INTO ydoc_state (doc_id, state) VALUES (?, ?)').run('legacy-block-doc', Buffer.from(Y.encodeStateAsUpdate(oldDoc)));
  const first = await yDocService.loadLatest('legacy-block-doc', { id: 'user-1' });
  const persistedOnce = Buffer.from(db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?').get('legacy-block-doc').state);
  const second = await yDocService.loadLatest('legacy-block-doc', { id: 'user-1' });
  const persistedTwice = Buffer.from(db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?').get('legacy-block-doc').state);
  assert.match(first.document.content[0].attrs.id, /^block_/);
  assert.equal(first.version, second.version);
  assert.deepEqual(persistedOnce, persistedTwice);
});

test('知识库、文件夹、文档、正文和块完整生命周期', async () => {
  const auth = { Authorization: `Bearer ${token1}` };
  const firstKb = await request(app).post('/api/v1/knowledge-bases').set(auth).set('Idempotency-Key', 'kb-1').send({ name: 'API KB' }).expect(201);
  const repeatedKb = await request(app).post('/api/v1/knowledge-bases').set(auth).set('Idempotency-Key', 'kb-1').send({ name: 'API KB' }).expect(201);
  assert.equal(repeatedKb.body.data.id, firstKb.body.data.id);
  await request(app).post('/api/v1/knowledge-bases').set(auth).set('Idempotency-Key', 'kb-1').send({ name: 'different' }).expect(409);

  const folder = await request(app).post('/api/v1/folders').set(auth).send({ name: 'Folder', knowledge_base_id: firstKb.body.data.id }).expect(201);
  const doc = await request(app).post('/api/v1/documents').set(auth).send({
    title: 'API Doc', folder_id: folder.body.data.id,
    content: { format: 'tiptap-json', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] } },
  }).expect(201);

  const content = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).expect(200);
  const etag = content.headers.etag;
  const blockId = content.body.data.document.content[0].attrs.id;
  assert.match(blockId, /^block_[0-9A-HJKMNP-TV-Z]{26}$/);

  await request(app).put(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).send({ format: 'tiptap-json', document: { type: 'doc', content: [] } }).expect(428);
  await request(app).put(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).set('If-Match', '"sha256:wrong"').send({ format: 'tiptap-json', document: { type: 'doc', content: [] } }).expect(409);

  const inserted = await request(app).post(`/api/v1/documents/${doc.body.data.id}/blocks`).set(auth).set('If-Match', etag).send({
    position: { document_end: true }, nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
  }).expect(201);
  const secondId = inserted.body.data.blocks[1].attrs.id;
  const batch = await request(app).post(`/api/v1/documents/${doc.body.data.id}/batch`).set(auth).send({
    base_version: inserted.body.data.version,
    operations: [{ op: 'replace', block_id: secondId, node: { type: 'heading', attrs: { id: secondId, level: 2 }, content: [{ type: 'text', text: 'changed' }] } }, { op: 'delete', block_id: blockId }],
  }).expect(200);
  const final = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content?format=markdown`).set(auth).expect(200);
  assert.match(final.body.data.content, /changed/);
  assert.equal(batch.body.data.operation_count, 2);

  await request(app).get(`/api/v1/documents/${doc.body.data.id}`).set('Authorization', `Bearer ${token2}`).expect(404);
  await request(app).delete(`/api/v1/documents/${doc.body.data.id}`).set(auth).expect(204);
  await request(app).delete(`/api/v1/knowledge-bases/${firstKb.body.data.id}`).set(auth).send({ confirm_id: firstKb.body.data.id }).expect(204);
});

test('Markdown、HTML 清洗、重复块 ID 和附件引用约束', async () => {
  const auth = { Authorization: `Bearer ${token1}` };
  const kb = await request(app).post('/api/v1/knowledge-bases').set(auth).send({ name: 'Formats' }).expect(201);
  const doc = await request(app).post('/api/v1/documents').set(auth).send({ title: 'Formats', knowledge_base_id: kb.body.data.id }).expect(201);
  const initial = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).expect(200);
  await request(app).put(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).set('If-Match', initial.headers.etag)
    .send({ format: 'markdown', content: '# 标题\n\n```mermaid\ngraph TD\n  A --> B\n```' }).expect(200);
  const markdownImported = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).expect(200);
  assert.equal(markdownImported.body.data.document.content[1].type, 'mermaidBlock');
  await request(app).put(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).set('If-Match', markdownImported.headers.etag)
    .send({ format: 'html', content: '<script>alert(1)</script><p onclick="bad()">safe</p>' }).expect(200);
  const exported = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content?format=html`).set(auth).expect(200);
  assert.doesNotMatch(exported.body.data.content, /script|onclick/);
  assert.match(exported.body.data.content, /safe/);

  const current = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).expect(200);
  const duplicate = 'block_01ARZ3NDEKTSV4RRFFQ69G5FAV';
  await request(app).put(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).set('If-Match', current.headers.etag).send({
    format: 'tiptap-json', document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: duplicate } }, { type: 'paragraph', attrs: { id: duplicate } }] },
  }).expect(422);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const attachment = await request(app).post('/api/v1/attachments').set(auth).field('document_id', doc.body.data.id).attach('file', png, { filename: 'pixel.png', contentType: 'image/png' }).expect(201);
  await request(app).get(`/app-api/v1/attachments/${attachment.body.data.id}`).set(auth).expect(401);
  await request(app).get(`/app-api/v1/attachments/${attachment.body.data.id}`).set('Cookie', cookie1).expect(200);
  const beforeImage = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).expect(200);
  await request(app).put(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).set('If-Match', beforeImage.headers.etag).send({
    format: 'tiptap-json', document: { type: 'doc', content: [{ type: 'image', attrs: { attachmentId: attachment.body.data.id, src: 'forged' } }] },
  }).expect(200);
  const imageDoc = await request(app).get(`/api/v1/documents/${doc.body.data.id}/content`).set(auth).expect(200);
  assert.equal(imageDoc.body.data.document.content[0].attrs.src, `/api/v1/attachments/${attachment.body.data.id}`);
  await request(app).delete(`/api/v1/attachments/${attachment.body.data.id}`).set(auth).expect(409);
  await request(app).delete(`/api/v1/attachments/${attachment.body.data.id}?force=true`).set(auth).expect(204);
});

test('OpenAPI 规范覆盖真实开放路由', async () => {
  const { openApi } = await import('../open-api/router.js');
  const { getOpenApiDocument } = await import('../openapi.js');
  const specPaths = new Set(Object.keys(getOpenApiDocument().paths));
  const routePaths = new Set(openApi.stack.filter((layer) => layer.route).map((layer) => layer.route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')));
  assert.deepEqual([...routePaths].filter((path) => !specPaths.has(path)), []);
  const response = await request(app).get('/api/openapi.json').expect(200);
  assert.equal(response.body.openapi, '3.1.0');
});

test('电子表格节点通过 Schema 校验并可降级导入导出 CSV', async () => {
  const { markdownToDocument, normalizeAndValidateDocument } = await import('../document-schema.js');
  const { documentToMarkdown, markdownWarnings } = await import('../markdown.js');
  const imported = markdownToDocument('```csv\n项目,金额\n设计,1200\n开发,=SUM(B2:B2)\n```');
  assert.equal(imported.content[0].type, 'spreadsheetBlock');
  assert.equal(imported.content[0].attrs.data.cells.A2, '设计');
  assert.equal(imported.content[0].attrs.data.cells.B3, '=SUM(B2:B2)');
  const normalized = normalizeAndValidateDocument(imported).document;
  assert.match(normalized.content[0].attrs.id, /^block_/);
  const markdown = documentToMarkdown(normalized);
  assert.match(markdown, /```csv/);
  assert.match(markdown, /开发,=SUM\(B2:B2\)/);
  assert.ok(markdownWarnings(normalized).some((warning) => warning.code === 'spreadsheet_degraded'));
});

test('页面新建电子表格会记录文档类型并初始化电子表格正文', async () => {
  const kb = await request(app).post('/app-api/v1/kb').set('Cookie', cookie1)
    .send({ name: 'Spreadsheet KB' }).expect(200);
  const created = await request(app).post('/app-api/v1/docs').set('Cookie', cookie1).send({
    id: 'doc-sheet-entry',
    title: '预算表',
    kb_id: kb.body.id,
    document_type: 'spreadsheet',
  }).expect(200);
  assert.equal(created.body.document_type, 'spreadsheet');
  const listed = await request(app).get(`/app-api/v1/kb/${kb.body.id}/docs`).set('Cookie', cookie1).expect(200);
  assert.equal(listed.body[0].document_type, 'spreadsheet');

  const { yDocService } = await import('../ydoc-service.js');
  const loaded = yDocService.loadRaw('doc-sheet-entry');
  const data = loaded.ydoc.getMap('spreadsheet').get('data');
  assert.equal(data.rows, 30);
  assert.equal(data.cols, 12);
  assert.deepEqual(data.cells, {});
});

test('旧模型的电子表格块可迁移为独立 Y.Map 数据', async () => {
  const { documentSchema } = await import('../document-schema.js');
  const { migrateStandaloneSpreadsheet } = await import('../ydoc-service.js');
  const { prosemirrorJSONToYDoc } = await import('y-prosemirror');
  const kb = db.prepare('INSERT INTO knowledge_bases (name, workspace_id) VALUES (?, ?)')
    .run('Legacy Sheet', 'workspace-user-1').lastInsertRowid;
  db.prepare('INSERT INTO documents (id, title, kb_id, document_type) VALUES (?, ?, ?, ?)')
    .run('legacy-sheet-doc', '旧电子表格', kb, 'spreadsheet');
  const ydoc = prosemirrorJSONToYDoc(documentSchema, {
    type: 'doc',
    content: [{
      type: 'spreadsheetBlock',
      attrs: {
        data: {
          version: 1, rows: 10, cols: 6, cells: { A1: '保留内容' }, styles: {},
          colWidths: {}, merges: [], frozenRows: 0, frozenCols: 0, filters: {},
        },
      },
    }],
  }, 'default');
  assert.equal(migrateStandaloneSpreadsheet(ydoc, 'legacy-sheet-doc'), true);
  assert.equal(ydoc.getMap('spreadsheet').get('data').cells.A1, '保留内容');
  assert.equal(migrateStandaloneSpreadsheet(ydoc, 'legacy-sheet-doc'), false);
});

test('四层限频桶和标准响应头', async () => {
  const { MemoryRateLimitStore, consumeLimit } = await import('../open-api/rate-limit.js');
  const store = new MemoryRateLimitStore();
  assert.equal(store.take('ip', 1, 1 / 60000, 0).allowed, true);
  assert.equal(store.take('ip', 1, 1 / 60000, 1).allowed, false);
  for (const key of ['unauth-ip', 'token-total', 'token-write', 'token-doc-write']) {
    assert.equal(store.take(key, 1, 1 / 60000, 0).allowed, true);
    assert.equal(store.take(key, 1, 1 / 60000, 0).allowed, false);
  }
  const headers = {};
  const res = { set(name, value) { headers[name] = value; } };
  assert.throws(() => {
    const req = {};
    consumeLimit(req, res, 'test-global-header', 1);
    consumeLimit(req, res, 'test-global-header', 1);
  }, /请求过于频繁/);
  assert.equal(headers['X-RateLimit-Remaining'], '0');
  assert.ok(headers['Retry-After']);
});
