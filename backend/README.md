# Doco Backend（Node.js + Hocuspocus）

基于 [Hocuspocus](https://tiptap.dev/docs/hocuspocus)（Tiptap 官方协同服务器）+ better-sqlite3 的协同后端。
同步协议（SyncStep1/2、awareness、防抖持久化、退出前 flush）全部由 Hocuspocus 处理，本目录只有薄薄一层业务代码。

## 启动

```bash
cd backend
npm install
npm start        # 或 npm run dev（文件变更自动重启）
```

服务监听 `http://0.0.0.0:8000`：

- WebSocket 协同：`ws://localhost:8000/ws`（文档名由 @hocuspocus/provider 在协议消息里传递，不走 URL 路径）
- REST API：`http://localhost:8000/api/...`

## 文件说明

| 文件 | 职责 |
|---|---|
| server.js | 入口：Express + Hocuspocus 集成、导出路由、优雅退出 |
| database.js | better-sqlite3 初始化与建表（WAL 模式，写即落盘） |
| api.js | 知识库/文件夹/文档 REST 路由 |
| markdown.js | YDoc → ProseMirror JSON → Markdown（schema 与前端一致） |
| migrate.js | 一次性迁移旧版 ydoc_updates 增量表 → ydoc_state 快照表 |
| schema.sql | 表结构参考（实际建表由 database.js 完成） |

## Markdown 导出（供 AI / 脚本读取文档）

```bash
# 单文档，永远返回最新协同状态（内存实时文档优先于落库快照）
curl http://localhost:8000/api/docs/{doc_id}/export.md

# 整个知识库打包（目录结构 = 文件夹结构）
curl -O http://localhost:8000/api/kb/{kb_id}/export.zip
```

## 持久化模型

- `ydoc_state`：每文档一行合并快照，UPSERT 更新，表大小恒定
- 写入时机：Hocuspocus 内置防抖（编辑停顿 2s / 最长 10s），最后一个连接断开时、进程收到 SIGINT/SIGTERM 时强制落库
- 旧版 `ydoc_updates` 增量表：`node migrate.js` 批量合并，或由 server.js 在文档首次加载时懒迁移；确认无误后可手动 DROP

## 数据恢复提示

前端浏览器 IndexedDB 是主存储。若后端快照缺失或不完整（历史 bug 遗留），
在前端打开该文档，Yjs 同步协议会自动把本地完整状态推给服务器并落库。
