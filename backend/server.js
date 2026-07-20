import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { Hocuspocus, IncomingMessage, MessageReceiver, MessageType } from '@hocuspocus/server';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { db } from './database.js';
import { api } from './api.js';
import { getSessionUserFromCookieHeader, requireAuth } from './auth.js';
import { stateToMarkdown } from './markdown.js';
import {
  getAttachmentForUser,
  getDocumentForUser,
  getFolderForUser,
  getKnowledgeBaseForUser,
  listFolderDocsForUser,
  listRootDocsForUser,
  listRootFoldersForUser,
  listSubfoldersForUser,
  userCanAccessDocument,
} from './permissions.js';
import {
  assertYDocsWithinQuota,
  loadLegacyState,
  migrateStandaloneSpreadsheet,
  persistYDoc,
  registerHocuspocus,
  yDocService,
} from './ydoc-service.js';
import { openApi } from './open-api/router.js';
import { openApiErrorHandler, openApiNotFound, requestContext } from './open-api/errors.js';
import { getOpenApiDocument } from './openapi.js';
import { createNativeTransferRouter } from './native-transfer.js';

const PORT = Number(process.env.PORT) || 8000;
// 生产环境由反向代理（Caddy）对外，服务本身只绑 127.0.0.1（systemd 里设 HOST）
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://doco-editor.pages.dev', 'https://doco.showme.talk', 'https://doco-editor.showme.talk']
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
const quotaRejectedConnections = new WeakSet();
export const hocuspocus = new Hocuspocus({
  quiet: true,

  async beforeHandleMessage({ connection, document, update }) {
    const inspect = new IncomingMessage(update);
    inspect.readVarString();
    const messageType = inspect.readVarUint();
    if (messageType !== MessageType.Sync && messageType !== MessageType.SyncReply) return;

    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
      const message = new IncomingMessage(update);
      message.readVarString();
      await new MessageReceiver(message).apply(candidate);
      assertYDocsWithinQuota(document, candidate);
    } catch (error) {
      if (error?.code === 'document_character_limit_exceeded' || error?.code === 'document_snapshot_limit_exceeded') {
        connection.sendStateless(JSON.stringify({
          type: 'doco:quota-error',
          code: error.code,
          message: error.message,
          details: error.details,
        }));
        quotaRejectedConnections.add(connection);
        connection.readOnly = true;
        return;
      }
      throw error;
    } finally {
      candidate.destroy();
    }
  },

  async afterHandleMessage({ connection }) {
    if (!quotaRejectedConnections.has(connection)) return;
    quotaRejectedConnections.delete(connection);
    connection.readOnly = false;
  },

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
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

app.get('/healthz', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

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
  // 前端需要读取 Content-Disposition 来还原导出文件名
  exposedHeaders: ['Content-Disposition'],
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

// 导出 zip 构建器：addDoc 写单个文档，walkFolder 递归写文件夹（含嵌套子文件夹）。
// 文档里的图片（附件引用或 data URI）一并打包进同目录 assets/，markdown 链接重写为相对路径。
const createExportZip = (userId) => {
  const zip = new JSZip();
  const usedNames = new Set();
  const assetsUsedByDir = new Map(); // 目录前缀 -> 已占用的图片文件名
  const imageNameCache = new Map();  // `${目录前缀}:${图片key}` -> 文件名（同一图片重复引用只存一份）

  const uniqueImageName = (prefix, base) => {
    let used = assetsUsedByDir.get(prefix);
    if (!used) assetsUsedByDir.set(prefix, (used = new Set()));
    let name = base;
    const dot = base.lastIndexOf('.');
    for (let i = 2; used.has(name); i++) {
      name = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
    }
    used.add(name);
    return name;
  };

  const storeImage = (prefix, key, base, data) => {
    const cacheKey = `${prefix}:${key}`;
    let name = imageNameCache.get(cacheKey);
    if (!name) {
      name = uniqueImageName(prefix, base);
      imageNameCache.set(cacheKey, name);
      zip.file(`${prefix}assets/${name}`, data);
    }
    return `assets/${name}`;
  };

  const bundleImages = (markdown, prefix) =>
    markdown.replace(/!\[[^\]]*\]\((\S+?)((?:\s+"[^"]*")?)\)/g, (full, url) => {
      const attachmentMatch = url.match(/\/attachments\/([\w-]+)/);
      if (attachmentMatch) {
        const attachment = getAttachmentForUser(userId, attachmentMatch[1]);
        if (!attachment) return full;
        let data;
        try { data = readFileSync(attachment.filepath); } catch { return full; }
        const name = storeImage(prefix, `att:${attachment.id}`, sanitizeFilename(attachment.filename), data);
        return full.replace(url, name);
      }
      const dataUriMatch = url.match(/^data:image\/([\w.+-]+);base64,(.+)$/);
      if (dataUriMatch) {
        const ext = dataUriMatch[1].replace('svg+xml', 'svg').replace(/[^a-z0-9]/gi, '') || 'png';
        const data = Buffer.from(dataUriMatch[2], 'base64');
        if (!data.length) return full;
        const key = `data:${data.length}:${dataUriMatch[2].slice(-64)}`;
        const name = storeImage(prefix, key, `image.${ext}`, data);
        return full.replace(url, name);
      }
      return full;
    });

  const addDoc = (doc, prefix) => {
    const ydoc = getLatestDocState(doc.id);
    let base = prefix + sanitizeFilename(doc.title);
    let name = `${base}.md`;
    for (let i = 2; usedNames.has(name); i++) name = `${base}-${i}.md`;
    usedNames.add(name);
    try {
      zip.file(name, bundleImages(stateToMarkdown(Y.encodeStateAsUpdate(ydoc)), prefix));
    } catch (error) {
      zip.file(`${base}.error.txt`, `导出失败: ${error.message}`);
    }
  };

  const walkFolder = (folderId, prefix) => {
    for (const doc of listFolderDocsForUser(userId, folderId)) {
      addDoc(doc, prefix);
    }
    for (const sub of listSubfoldersForUser(userId, folderId)) {
      walkFolder(sub.id, `${prefix}${sanitizeFilename(sub.name)}/`);
    }
  };

  return { zip, addDoc, walkFolder };
};

const sendZip = async (res, zip, filename) => {
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeFilename(filename))}.zip`);
  res.send(buffer);
};

const exportKnowledgeBase = async (req, res) => {
  const kb = getKnowledgeBaseForUser(req.user.id, req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });

  const { zip, addDoc, walkFolder } = createExportZip(req.user.id);
  for (const doc of listRootDocsForUser(req.user.id, kb.id)) {
    addDoc(doc, '');
  }
  for (const folder of listRootFoldersForUser(req.user.id, kb.id)) {
    walkFolder(folder.id, `${sanitizeFilename(folder.name)}/`);
  }
  await sendZip(res, zip, kb.name);
};

app.get('/app-api/v1/kb/:id/export.zip', requireAuth, exportKnowledgeBase);
app.get('/api/kb/:id/export.zip', requireAuth, exportKnowledgeBase); // 发布过渡期兼容路径

const exportFolder = async (req, res) => {
  const folder = getFolderForUser(req.user.id, req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  const { zip, walkFolder } = createExportZip(req.user.id);
  walkFolder(folder.id, '');
  await sendZip(res, zip, folder.name);
};

app.get('/app-api/v1/folders/:id/export.zip', requireAuth, exportFolder);
app.get('/api/folders/:id/export.zip', requireAuth, exportFolder); // 发布过渡期兼容路径

app.get('/api/openapi.json', (_req, res) => res.json(getOpenApiDocument()));
app.use('/api/v1', openApi, openApiNotFound, openApiErrorHandler);
app.use('/app-api/v1/native-transfer', createNativeTransferRouter({ getLatestDocState }));
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
