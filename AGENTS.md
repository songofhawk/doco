# Doco Editor — 项目说明

基于 **Tiptap (ProseMirror) + React + Vite** 的富文本协同编辑器，支持多端实时同步（Yjs CRDT），具备知识库管理能力。

永远输出中文。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + Vite + TypeScript |
| 路由 | react-router-dom v7 |
| CSS | Tailwind CSS v4 |
| 编辑器 | Tiptap v3（基于 ProseMirror） |
| UI 组件 | Radix UI (Popover)、Lucide React (图标)、Tippy.js (弹层) |
| 协同算法 | Yjs (CRDT) + Hocuspocus（@hocuspocus/provider / @hocuspocus/server） |
| 图表 | Mermaid、PlantUML (plantuml-encoder) |
| 导出/导入 | 服务端 Markdown 导出（prosemirror-markdown）、html2pdf.js、mammoth、pdfjs-dist |
| 后端 | Node.js + Express + Hocuspocus |
| 数据库 | better-sqlite3（SQLite，WAL 模式） |

> 后端曾有 Python (FastAPI + ypy-websocket) 与 Cloudflare Worker 两版实现，均因同步协议缺陷于 2026-07 移除，
> 决策依据见 [docs/重构方案-协同同步与Markdown导出.md](../docs/重构方案-协同同步与Markdown导出.md)。

---

## 目录结构

```
doco/
├── src/
│   ├── main.tsx                       # 应用入口
│   ├── App.tsx                        # 根组件，路由管理（/ 首页、/app 工作区、/app/doc/:id 文档，
│   │                                  #   旧 /doc/:id 自动重定向），工作区外壳，导入/导出
│   ├── components/
│   │   ├── HomePage.tsx               # 落地首页：品牌展示 + 登录面板（邮箱验证码 / Google），
│   │   │                              #   登录后跳转 /app；未登录访问 /app 会带回跳参数
│   │   └── Sidebar.tsx                # 知识库侧边栏（文档树管理）
│   └── editor/                        # 编辑器模块（与 App 同仓同构建，无独立编译步骤）
│       ├── DocoEditor.tsx             # 编辑器主组件（Yjs/Hocuspocus 初始化、扩展注册）
│       ├── types.ts                   # 对外 Props/Ref 类型
│       └── components/                # 各扩展与 UI（BubbleMenu、BlockHandle、MermaidBlock、
│                                      #   CalloutBlock、SlashCommand、CollapseExtension 等）
├── backend/
│   ├── server.js                      # 入口：Express + Hocuspocus + 导出路由 + 优雅退出
│   ├── database.js                    # better-sqlite3 初始化与建表
│   ├── api.js                         # 知识库/文件夹/文档 REST 路由
│   ├── markdown.js                    # YDoc → ProseMirror JSON → Markdown（服务端导出）
│   ├── migrate.js                     # 旧版 ydoc_updates → ydoc_state 一次性迁移
│   └── schema.sql                     # 表结构参考
└── src/index.css                      # 全局样式（ProseMirror、折叠块等）
```

---

## 协同编辑架构

```
前端 IndexedDB (y-indexeddb) ← 本地主存储
       ↕
前端 Y.Doc ← @hocuspocus/provider (HocuspocusProviderWebsocket)
       ↕  Yjs 二进制增量消息（文档名走协议消息，不走 URL）
后端 @hocuspocus/server → SQLite ydoc_state 表（每文档一行合并快照，UPSERT）
```

**关键实现要点（[DocoEditor.tsx](../src/editor/DocoEditor.tsx)）：**

```tsx
// 1. socket 与 provider 分开持有；显式传 websocketProvider 时必须手动 provider.attach()
const collab = useMemo(() => {
    const socket = new HocuspocusProviderWebsocket({ url, connect: false })
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: docId, document: ydoc })
    provider.attach()
    return { socket, provider }
}, [ydoc, docId, collaboration])

// 2. IndexedDB 先加载，再连接；React 18 StrictMode 下 cleanup 只 disconnect 不 destroy
useEffect(() => {
    const idb = new IndexeddbPersistence(`doco-${docId}`, ydoc)
    idb.once('synced', () => collab.socket.connect())
    return () => { collab.socket.disconnect(); idb.destroy() }
}, [collab, ydoc, docId])
```

- 初始状态互补由 Hocuspocus 的 SyncStep1/2 协议双向完成，**不需要**任何"空事务推送"之类的 hack。
- `extensions` 数组必须用 `useMemo` 稳定；StarterKit 的 `undoRedo` 在协同模式下必须禁用（与 Collaboration 冲突）。
- 协同光标：Tiptap v3 可用 `@tiptap/extension-collaboration-caret`（需 Hocuspocus awareness，当前未启用）。

**后端持久化（backend/server.js）：**

- `onLoadDocument`：读 `ydoc_state` 快照；没有则从旧版 `ydoc_updates` 增量表懒迁移（`Y.mergeUpdates`）。
- `onStoreDocument`：`Y.encodeStateAsUpdate` 整体 UPSERT。Hocuspocus 内置防抖（2s/最长 10s），最后一个连接断开与 SIGINT/SIGTERM 时强制落库。
- ⚠️ 禁止对 Yjs 数据做 `length > 2` 之类的"经验过滤"——历史上两次丢数据事故都源于此。
- ⚠️ 禁止把增量 update 应用到空白 Y.Doc 再 `encodeStateAsUpdate` 重编码，合并增量一律用 `Y.mergeUpdates`。

---

## Markdown 导出

**Markdown 是 YDoc 的派生物，由服务端按需生成，不做前端定时推送。**

- 单文档：`GET /api/docs/{id}/export.md`（内存实时文档优先，永远是最新状态）
- 知识库打包：`GET /api/kb/{id}/export.zip`（目录结构 = 文件夹结构）
- 实现：[backend/markdown.js](../backend/markdown.js)，schema 与前端扩展一致；
  **前端新增自定义节点时，需同步在 markdown.js 里补 schema 定义和序列化规则**。
- 前端手动导出（工具栏按钮）用 tiptap-markdown；自定义节点（Mermaid/PlantUML/Callout）已通过
  `addStorage().markdown.serialize` 提供规则，Mermaid/PlantUML 同时支持从 ```mermaid 围栏导入。

---

## 核心功能索引

- **编辑器扩展注册**：`src/editor/DocoEditor.tsx`（StarterKit、CodeBlockLowlight、表格、任务列表、Mermaid/PlantUML/Callout、ResizableImage、折叠、快捷键、SlashCommand、Collaboration）
- **浮动工具栏** BubbleMenu.tsx / **块操作手柄** BlockHandle.tsx / **`/` 命令面板** SlashCommand + suggestions.ts（支持中文拼音缩写模糊搜索）
- **块折叠** CollapseExtension.ts（ProseMirror Plugin + Decoration，折叠位置存 documents.collapsed_blocks）
- **键盘快捷键** KeyboardShortcuts.ts（⌥↑/↓ 移块、⌘D 复制块、⌘⌥1/2/3/0 标题切换、⌘K 链接等）
- **知识库管理** Sidebar.tsx + REST API（知识库 → 文件夹（可嵌套）→ 文档）
- **文档设置** DocSettings.tsx（标题多级编号、背景色）
- **导入**（App.tsx）：Markdown / Word（mammoth）/ PDF（pdfjs-dist）

---

## 启动方式

```bash
# 前端（Vite 开发服务器）
pnpm run dev

# 后端（Node 协同服务器，监听 :8000）
cd backend
npm start          # 或 npm run dev（自动重启）
```

---

## 开发规范

1. **全局对话框必须使用 Portal**：`createPortal(content, document.body)`，避免被父容器 CSS 影响。
2. **Playwright 测试必须无头模式**（headless），避免弹出浏览器窗口干扰用户。
3. **数据安全**：改动持久化相关代码前先备份 `backend/doco.db`；前端 IndexedDB 是主存储，
   后端快照缺失时在前端打开文档即可自动回传补全。

---

## 已知问题 & 待办

- 协同光标未启用（v3 有 collaboration-caret，可配合 Hocuspocus awareness 实现）
- 旧版 `ydoc_updates` 表在确认迁移无误后可 DROP（migrate.js 已保留说明）
- 生产部署：`.env.production` 需填入自托管后端地址；`pnpm run deploy` 仅部署前端静态文件到 Cloudflare Pages
