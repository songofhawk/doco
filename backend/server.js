import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { db, hasLegacyUpdatesTable } from './database.js';
import { api } from './api.js';
import { stateToMarkdown } from './markdown.js';

const PORT = Number(process.env.PORT) || 8000;
// 生产环境由反向代理（Caddy）对外，服务本身只绑 127.0.0.1（systemd 里设 HOST）
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://doco-editor.pages.dev']
  : [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
    ];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const selectState = db.prepare('SELECT state FROM ydoc_state WHERE doc_id = ?');
const upsertState = db.prepare(`
  INSERT INTO ydoc_state (doc_id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(doc_id) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
`);

// 从旧版 ydoc_updates 增量表懒迁移（合并所有增量为单快照）
function loadLegacyState(docName) {
  if (!hasLegacyUpdatesTable) return null;
  const rows = db.prepare('SELECT [update] FROM ydoc_updates WHERE doc_id = ? ORDER BY id').all(docName);
  if (rows.length === 0) return null;
  return Y.mergeUpdates(rows.map(r => new Uint8Array(r.update)));
}

export const hocuspocus = new Hocuspocus({
  quiet: true,

  async onLoadDocument({ document, documentName }) {
    const row = selectState.get(documentName);
    let state = row?.state;
    if (!state) {
      const legacy = loadLegacyState(documentName);
      if (legacy) {
        state = legacy;
        upsertState.run(documentName, Buffer.from(legacy));
        console.log(`[YDoc] Migrated legacy updates for ${documentName} (${legacy.length} bytes)`);
      }
    }
    if (state) Y.applyUpdate(document, state);
    return document;
  },

  // Hocuspocus 内置防抖（debounce 2s / maxDebounce 10s），断开最后一个连接时也会触发
  async onStoreDocument({ document, documentName }) {
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    upsertState.run(documentName, state);
    console.log(`[YDoc] Stored ${documentName}: ${state.length} bytes`);
  },
});

// 导出时优先取内存中的实时文档（可能比落库状态新 ≤10s）
function getLatestDocState(docId) {
  const live = hocuspocus.documents.get(docId);
  if (live) return Y.encodeStateAsUpdate(live);
  const row = selectState.get(docId);
  return row?.state || loadLegacyState(docId);
}

function sanitizeFilename(name) {
  return (name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
}

const app = express();

function isOriginAllowed(origin) {
  // curl、健康检查、同源反代等请求通常没有 Origin；只拦浏览器跨源来源。
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function rejectDisallowedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (isOriginAllowed(origin)) return next();
  res.status(403).json({ error: 'Forbidden origin' });
}

app.use(rejectDisallowedOrigin);
app.use(cors({
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin) ? origin || false : false);
  },
}));
app.use(express.json({ limit: '10mb' }));

app.get('/api/docs/:id/export.md', (req, res) => {
  const state = getLatestDocState(req.params.id);
  if (!state) return res.status(404).json({ error: 'Not found' });
  try {
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(stateToMarkdown(state));
  } catch (error) {
    res.status(500).json({ error: `导出失败: ${error.message}` });
  }
});

app.get('/api/kb/:id/export.zip', async (req, res) => {
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  const zip = new JSZip();
  const usedNames = new Set();

  const addDoc = (doc, prefix) => {
    const state = getLatestDocState(doc.id);
    if (!state) return;
    let base = prefix + sanitizeFilename(doc.title);
    let name = `${base}.md`;
    for (let i = 2; usedNames.has(name); i++) name = `${base}-${i}.md`;
    usedNames.add(name);
    try {
      zip.file(name, stateToMarkdown(state));
    } catch (error) {
      zip.file(`${base}.error.txt`, `导出失败: ${error.message}`);
    }
  };

  const walkFolder = (folderId, prefix) => {
    for (const doc of db.prepare('SELECT * FROM documents WHERE folder_id = ?').all(folderId)) {
      addDoc(doc, prefix);
    }
    for (const sub of db.prepare('SELECT * FROM folders WHERE parent_id = ?').all(folderId)) {
      walkFolder(sub.id, `${prefix}${sanitizeFilename(sub.name)}/`);
    }
  };

  for (const doc of db.prepare('SELECT * FROM documents WHERE kb_id = ? AND folder_id IS NULL').all(kb.id)) {
    addDoc(doc, '');
  }
  for (const folder of db.prepare('SELECT * FROM folders WHERE kb_id = ? AND parent_id IS NULL').all(kb.id)) {
    walkFolder(folder.id, `${sanitizeFilename(folder.name)}/`);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeFilename(kb.name))}.zip`);
  res.send(buffer);
});

app.use('/api', api);

const server = app.listen(PORT, HOST, () => {
  console.log(`Doco Backend (Node.js + Hocuspocus) running on http://${HOST}:${PORT}`);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  if (!isOriginAllowed(request.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, request) => {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([, v]) => typeof v === 'string')
  );
  const fetchRequest = new Request(`http://localhost:${PORT}${request.url}`, { headers });
  const connection = hocuspocus.handleConnection(ws, fetchRequest);

  ws.on('message', (data) => connection.handleMessage(new Uint8Array(data)));
  ws.on('close', () => connection.handleClose());
});

function shutdown() {
  console.log('Shutting down, flushing pending stores...');
  hocuspocus.flushPendingStores();
  // onStoreDocument 是同步 SQLite 写入，微任务队列排空后即已落盘
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
