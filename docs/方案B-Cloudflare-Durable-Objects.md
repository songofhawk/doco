# 方案 B：Cloudflare Durable Objects — 零运维 Serverless

## 概述

将现有 Python FastAPI 后端整体迁移到 Cloudflare Workers + Durable Objects。每个文档对应一个 DO 实例，内置 SQLite 存储和 WebSocket 支持，功能完全不降级（包括实时协同），零运维。

## 架构

```
前端 (React + Yjs)
  ↕ y-websocket（URL 改为 Cloudflare Worker）
Cloudflare Worker（路由层）
  ├── /ws/{room} → Durable Object（协同 + 持久化）
  └── /api/*     → REST API 处理（CRUD）
         ↕
  Durable Object 内置 SQLite
```

## 免费层关键参数

| 项目 | 免费层 | 付费层（$5/月起） |
|------|--------|-------------------|
| 总存储 | 5GB（账户级） | 50GB+ |
| 存储后端 | 仅 SQLite | SQLite + KV |
| DO 类数量 | 100 | 500 |
| WebSocket | 支持 Hibernation API | 同左 |
| 冷启动 | 200-500ms | 同左 |
| 单行/单值 | 最大 2MB | 同左 |
| CPU 时间 | 30秒/请求 | 5分钟/请求 |

- 2025 年 4 月起免费层已支持 Durable Objects
- 5GB 存储可存 50,000+ 文档（假设平均 100KB/文档）
- WebSocket Hibernation：DO 空闲时休眠，仅处理消息时计费，节省 80-95% 持续时间成本

## 现有生态

- [y-durableobjects](https://github.com/napolab/y-durableobjects)：最成熟的 Yjs + Cloudflare DO 方案，兼容 y-websocket 协议，前端无需改动
- [@pluv/io](https://github.com/pluv-io/pluv)：完整协同框架，支持 DO 后端，功能更全但学习曲线陡
- 前端 y-websocket Provider **只需改 WebSocket URL**，其余代码不变

## 迁移工作量评估

| 模块 | 工作量 | 说明 |
|------|--------|------|
| WebSocket 协同 | 中 | 用 y-durableobjects 或自实现 DO WebSocket，前端不变 |
| REST API（CRUD） | 中 | 从 FastAPI 改写为 Workers 路由，无 ORM，手写 SQL |
| 数据迁移 | 低 | 导出现有 SQLite 数据为 JSON，导入 DO SQLite |
| 认证（当前无） | 高 | 需新增 JWT/Session 管理，当前项目无认证机制 |
| 跨文档搜索 | 中 | DO 之间隔离，需用 D1 或 KV 维护中央索引 |

## 核心代码示例

### Worker 路由层

```typescript
// src/index.ts — Cloudflare Worker 入口
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    // WebSocket 协同 → 路由到对应文档的 DO
    if (url.pathname.startsWith('/ws/')) {
      const roomId = url.pathname.split('/')[2]
      const id = env.YDOC_DO.idFromName(roomId)
      const stub = env.YDOC_DO.get(id)
      return stub.fetch(request)
    }

    // REST API → 路由到中央数据 DO 或 D1
    if (url.pathname.startsWith('/api/')) {
      return handleRestAPI(request, env)
    }

    return new Response('Not Found', { status: 404 })
  },
}
```

### Durable Object（文档协同）

```typescript
// src/ydoc-do.ts — 每个文档一个 DO 实例
export class YDocDO extends DurableObject {
  private sessions = new Set<WebSocket>()

  async fetch(request: Request) {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])  // Hibernation API
      this.sessions.add(pair[1])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    return new Response('Expected WebSocket', { status: 400 })
  }

  // Hibernation API：DO 休眠后收到消息时自动唤醒
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const data = new Uint8Array(message as ArrayBuffer)
    // 持久化到 DO 内置 SQLite
    this.ctx.storage.sql.exec(
      'INSERT INTO updates (data) VALUES (?)', data
    )
    // 广播给其他客户端
    for (const session of this.sessions) {
      if (session !== ws) session.send(data)
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws)
  }
}
```

## 迁移路径

### 第一阶段：协同后端迁移

1. 部署 y-durableobjects 或自实现 DO WebSocket 处理
2. 前端 `WebsocketProvider` 的 URL 从 `ws://127.0.0.1:8000/ws/{room}` 改为 `wss://your-worker.dev/ws/{room}`
3. 保留现有 FastAPI 作为 REST API 不动

### 第二阶段：REST API 迁移

1. 将知识库/文件夹/文档 CRUD 改写为 Workers 路由
2. 使用 Cloudflare D1（托管 SQLite）存储元数据，或用一个专门的 DO 实例
3. 灰度切换：前端同时支持新旧 API，逐步迁移

### 第三阶段：下线 FastAPI

1. 数据完全迁移到 Cloudflare
2. 下线 Python 后端
3. 可选：集成用户云盘同步（DO 作为中继，数据最终同步到用户 Drive）
