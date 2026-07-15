import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from 'y-prosemirror';

const tempDir = mkdtempSync(join(tmpdir(), 'doco-collaboration-test-'));
process.env.DOCO_DB_PATH = join(tempDir, 'test.db');
process.env.DOCO_ATTACHMENTS_PATH = join(tempDir, 'attachments');
process.env.OPEN_API_RATE_LIMIT_PER_MINUTE = '10000';
process.env.OPEN_API_WRITE_RATE_LIMIT_PER_MINUTE = '10000';
process.env.OPEN_API_DOCUMENT_WRITE_RATE_LIMIT_PER_MINUTE = '10000';

let db;
let server;
let baseUrl;
let token;
let cookie;
let provider;
let socketProvider;
let clientDoc;
let hocuspocus;
let documentSchema;

function waitFor(predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error('等待协同状态超时')); }
    }, 20);
  });
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

before(async () => {
  ({ db } = await import('../database.js'));
  const { createApiToken } = await import('../open-api/tokens.js');
  const { createSession } = await import('../auth.js');
  ({ documentSchema } = await import('../document-schema.js'));
  const serverModule = await import('../server.js');
  hocuspocus = serverModule.hocuspocus;
  const now = Date.now();
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run('collab-user', 'collab-google', 'collab@example.com', 'Collab', null, now, now);
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)').run('collab-workspace', 'Collab', 'collab-user', now, now);
  db.prepare('INSERT INTO workspace_members VALUES (?, ?, ?, ?)').run('collab-workspace', 'collab-user', 'owner', now);
  const kb = db.prepare('INSERT INTO knowledge_bases (name, workspace_id) VALUES (?, ?)').run('Collab KB', 'collab-workspace').lastInsertRowid;
  db.prepare('INSERT INTO documents (id, title, kb_id) VALUES (?, ?, ?)').run('collab-doc', 'Collab Doc', kb);
  token = createApiToken('collab-user', { name: 'collab', access: 'read_write' }).token;
  cookie = `doco_session=${createSession('collab-user').token}`;

  server = serverModule.startServer({ port: 0, host: '127.0.0.1', installSignalHandlers: false });
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  class AuthWebSocket extends WebSocket {
    constructor(address, protocols) { super(address, protocols, { headers: { Cookie: cookie, Origin: 'http://localhost:5173' } }); }
  }
  clientDoc = new Y.Doc();
  socketProvider = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}/ws`, autoConnect: false, WebSocketPolyfill: AuthWebSocket });
  provider = new HocuspocusProvider({ websocketProvider: socketProvider, name: 'collab-doc', document: clientDoc });
  provider.attach(); socketProvider.connect();
  await waitFor(() => provider.synced === true);
});

after(async () => {
  provider?.destroy(); socketProvider?.destroy();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve) => server?.close(resolve));
  try { db.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
});

test('真实 Hocuspocus 链路双向同步、在线优先与响应前持久化', async () => {
  const current = await api('/documents/collab-doc/content');
  assert.equal(current.response.status, 200);
  const put = await api('/documents/collab-doc/content', {
    method: 'PUT', headers: { 'If-Match': current.response.headers.get('etag') },
    body: JSON.stringify({ format: 'tiptap-json', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'API 写入' }] }] } }),
  });
  assert.equal(put.response.status, 200);
  await waitFor(() => yDocToProsemirrorJSON(clientDoc, 'default').content?.[0]?.content?.[0]?.text === 'API 写入');

  const persisted = db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?').get('collab-doc');
  assert.ok(persisted?.state?.length > 0, 'API 响应前必须已写入 ydoc_state');

  clientDoc.transact(() => {
    prosemirrorJSONToYXmlFragment(documentSchema, {
      type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'block_01ARZ3NDEKTSV4RRFFQ69G5FAV' }, content: [{ type: 'text', text: '页面尚未防抖落库' }] }],
    }, clientDoc.getXmlFragment('default'));
  }, 'test-client');
  await waitFor(() => hocuspocus.documents.get('collab-doc') && yDocToProsemirrorJSON(hocuspocus.documents.get('collab-doc'), 'default').content?.[0]?.content?.[0]?.text === '页面尚未防抖落库');

  const liveRead = await api('/documents/collab-doc/content');
  assert.equal(liveRead.response.status, 200);
  assert.equal(liveRead.body.data.document.content[0].content[0].text, '页面尚未防抖落库');

  clientDoc.transact(() => {
    prosemirrorJSONToYXmlFragment(documentSchema, {
      type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'block_01ARZ3NDEKTSV4RRFFQ69G5FAV' }, content: [{ type: 'text', text: '快捷键手动保存已落库' }] }],
    }, clientDoc.getXmlFragment('default'));
  }, 'test-client');
  await waitFor(() => yDocToProsemirrorJSON(hocuspocus.documents.get('collab-doc'), 'default').content?.[0]?.content?.[0]?.text === '快捷键手动保存已落库');

  let saveResult;
  const onStateless = ({ payload }) => {
    const message = JSON.parse(payload);
    if (message.type === 'doco:save-result' && message.requestId === 'test-save') saveResult = message;
  };
  provider.on('stateless', onStateless);
  provider.sendStateless(JSON.stringify({ type: 'doco:save', requestId: 'test-save' }));
  await waitFor(() => saveResult);
  provider.off('stateless', onStateless);
  assert.equal(saveResult.ok, true);
  const manuallyPersisted = db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?').get('collab-doc');
  const persistedDoc = new Y.Doc();
  Y.applyUpdate(persistedDoc, new Uint8Array(manuallyPersisted.state));
  assert.equal(yDocToProsemirrorJSON(persistedDoc, 'default').content[0].content[0].text, '快捷键手动保存已落库');

  provider.destroy(); socketProvider.destroy();
  await waitFor(() => !hocuspocus.documents.has('collab-doc'));
  const offlineRead = await api('/documents/collab-doc/content');
  assert.equal(offlineRead.body.data.document.content[0].content[0].text, '快捷键手动保存已落库');
});
