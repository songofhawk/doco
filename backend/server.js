import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { fileURLToPath } from 'url';
import { db } from './database.js';
import { api } from './api.js';
import { getSessionUserFromCookieHeader, requireAuth } from './auth.js';
import { stateToMarkdown } from './markdown.js';
import {
  getDocumentForUser,
  getKnowledgeBaseForUser,
  listFolderDocsForUser,
  listRootDocsForUser,
  listRootFoldersForUser,
  listSubfoldersForUser,
  userCanAccessDocument,
} from './permissions.js';
import { loadLegacyState, migrateStandaloneSpreadsheet, persistYDoc, registerHocuspocus, yDocService } from './ydoc-service.js';
import { openApi } from './open-api/router.js';
import { openApiErrorHandler, openApiNotFound, requestContext } from './open-api/errors.js';
import { getOpenApiDocument } from './openapi.js';

const PORT = Number(process.env.PORT) || 8000;
// 生产环境由反向代理（Caddy）对外，服务本身只绑 127.0.0.1（systemd 里设 HOST）
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://doco-editor.pages.dev', 'https://doco.showme.talk']
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
export const hocuspocus = new Hocuspocus({
  quiet: true,

  async onAuthenticate({ context, documentName }) {
    if (!context?.user || !userCanAccessDocument(context.user.id, documentName)) {
      throw new Error('Not authorized');
    }
  },

  async onLoadDocument({ context, document, documentName }) {
    if (!context?.user || !userCanAccessDocument(context.user.id, documentName)) {
      throw new Error('Not authorized');
    }

    const row = selectState.get(documentName);
    let state = row?.state;
    if (!state) {
      const legacy = loadLegacyState(documentName);
      if (legacy) {
        state = legacy;
        db.prepare(`
          INSERT INTO ydoc_state (doc_id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(doc_id) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
        `).run(documentName, Buffer.from(legacy));
        console.log(`[YDoc] Migrated legacy updates for ${documentName} (${legacy.length} bytes)`);
      }
    }
    if (state) Y.applyUpdate(document, state);
    if (migrateStandaloneSpreadsheet(document, documentName)) {
      persistYDoc(documentName, document);
      console.log(`[Spreadsheet] Migrated standalone data for ${documentName}`);
    }
    return document;
  },

  // Hocuspocus 内置防抖（debounce 2s / maxDebounce 10s），断开最后一个连接时也会触发
  async onStoreDocument({ context, document, documentName }) {
    if (context?.user && !userCanAccessDocument(context.user.id, documentName)) {
      throw new Error('Not authorized');
    }

    const state = persistYDoc(documentName, document);
    console.log(`[YDoc] Stored ${documentName}: ${state.length} bytes`);
  },

  async onStateless({ connection, document, documentName, payload }) {
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (message?.type !== 'doco:save' || typeof message.requestId !== 'string') return;

    if (!connection.context?.user || !userCanAccessDocument(connection.context.user.id, documentName)) {
      connection.sendStateless(JSON.stringify({
        type: 'doco:save-result',
        requestId: message.requestId,
        ok: false,
        error: 'Not authorized',
      }));
      return;
    }

    try {
      // Stateless 指令与该连接之前的 Yjs 更新有序处理，此处快照包含快捷键前的最新编辑。
      const state = persistYDoc(documentName, document);
      console.log(`[YDoc] Manually stored ${documentName}: ${state.length} bytes`);
      connection.sendStateless(JSON.stringify({
        type: 'doco:save-result',
        requestId: message.requestId,
        ok: true,
      }));
    } catch (error) {
      connection.sendStateless(JSON.stringify({
        type: 'doco:save-result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : 'Save failed',
      }));
    }
  },
});
registerHocuspocus(hocuspocus);

// 导出时优先取内存中的实时文档（可能比落库状态新 ≤10s）
function getLatestDocState(docId) {
  return yDocService.loadRaw(docId).ydoc;
}

function sanitizeFilename(name) {
  return (name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
}

export const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

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
  credentials: true,
}));
app.use('/api/v1', requestContext);
app.use(express.json({ limit: '10mb' }));
app.use((error, req, res, next) => {
  if (req.path.startsWith('/api/v1')) return openApiErrorHandler(error, req, res, next);
  next(error);
});

const exportMarkdown = (req, res) => {
  const doc = getDocumentForUser(req.user.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const ydoc = getLatestDocState(doc.id);
  try {
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(stateToMarkdown(Y.encodeStateAsUpdate(ydoc)));
  } catch (error) {
    res.status(500).json({ error: `导出失败: ${error.message}` });
  }
};

app.get('/app-api/v1/docs/:id/export.md', requireAuth, exportMarkdown);
app.get('/api/docs/:id/export.md', requireAuth, exportMarkdown); // 发布过渡期兼容路径

const exportKnowledgeBase = async (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  const zip = new JSZip();
  const usedNames = new Set();

  const addDoc = (doc, prefix) => {
    const ydoc = getLatestDocState(doc.id);
    let base = prefix + sanitizeFilename(doc.title);
    let name = `${base}.md`;
    for (let i = 2; usedNames.has(name); i++) name = `${base}-${i}.md`;
    usedNames.add(name);
    try {
      zip.file(name, stateToMarkdown(Y.encodeStateAsUpdate(ydoc)));
    } catch (error) {
      zip.file(`${base}.error.txt`, `导出失败: ${error.message}`);
    }
  };

  const walkFolder = (folderId, prefix) => {
    for (const doc of listFolderDocsForUser(req.user.id, folderId)) {
      addDoc(doc, prefix);
    }
    for (const sub of listSubfoldersForUser(req.user.id, folderId)) {
      walkFolder(sub.id, `${prefix}${sanitizeFilename(sub.name)}/`);
    }
  };

  for (const doc of listRootDocsForUser(req.user.id, kb.id)) {
    addDoc(doc, '');
  }
  for (const folder of listRootFoldersForUser(req.user.id, kb.id)) {
    walkFolder(folder.id, `${sanitizeFilename(folder.name)}/`);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeFilename(kb.name))}.zip`);
  res.send(buffer);
};

app.get('/app-api/v1/kb/:id/export.zip', requireAuth, exportKnowledgeBase);
app.get('/api/kb/:id/export.zip', requireAuth, exportKnowledgeBase); // 发布过渡期兼容路径

app.get('/api/openapi.json', (_req, res) => res.json(getOpenApiDocument()));
app.use('/api/v1', openApi, openApiNotFound, openApiErrorHandler);
app.use('/app-api/v1', api);
app.use('/api', (req, _res, next) => {
  console.warn(`[Deprecated] ${req.method} /api${req.path} 请迁移到 /app-api/v1`);
  next();
}, api);

function attachWebsocketServer(server, port) {
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
  const user = getSessionUserFromCookieHeader(request.headers.cookie || '');
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    request.user = user;
    wss.emit('connection', ws, request);
  });
  });

  wss.on('connection', (ws, request) => {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([, v]) => typeof v === 'string')
  );
  const fetchRequest = new Request(`http://localhost:${port}${request.url}`, { headers });
  const connection = hocuspocus.handleConnection(ws, fetchRequest, { user: request.user });

  ws.on('message', (data) => connection.handleMessage(new Uint8Array(data)));
  ws.on('close', () => connection.handleClose());
  });
  return wss;
}

export function startServer({ port = PORT, host = HOST, installSignalHandlers = true } = {}) {
  const server = app.listen(port, host, () => {
    console.log(`Doco Backend (Node.js + Hocuspocus) running on http://${host}:${port}`);
  });
  attachWebsocketServer(server, port);
  const shutdown = () => {
  console.log('Shutting down, flushing pending stores...');
  hocuspocus.flushPendingStores();
  // onStoreDocument 是同步 SQLite 写入，微任务队列排空后即已落盘
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 300);
  };
  if (installSignalHandlers) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return server;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) startServer();
