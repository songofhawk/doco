# Doco Editor — 项目说明

基于 **Tiptap (ProseMirror) + React + Vite** 的富文本协同编辑器，支持多端实时同步（Yjs CRDT），具备知识库管理能力。

永远输出中文。

---

## 自动导出 Markdown

系统支持后端自动导出文档为 Markdown 文件，方便 AI 读取文档内容。

**实现方案：**
- 后端导出：使用 `export_service.py` 从数据库重建 YDoc 并转换为 Markdown
- 导出路径：`exports/{知识库}/{文件夹}/{文档标题}.md`
- 手动触发：`python backend/batch_export.py` 批量导出所有文档

**已知问题：**
- 历史数据可能不完整：之前的 bug (`len(data) <= 2` 过滤) 导致部分文档的更新记录丢失
- 数据存储：前端使用 IndexedDB 作为主存储，后端数据库作为备份
- 恢复方法：在前端打开文档并编辑，触发完整同步到后端

**关键文件：**
- 后端导出服务：[export_service.py](backend/export_service.py)
- 批量导出脚本：[batch_export.py](backend/batch_export.py)
- 持久化修复：[main.py:44-46](backend/main.py#L44-L46) 移除了 `len(data) <= 2` 过滤

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + Vite + TypeScript |
| 路由 | react-router-dom v7 |
| CSS | Tailwind CSS v4 |
| 编辑器 | Tiptap v3（基于 ProseMirror） |
| UI 组件 | Radix UI (Popover)、Lucide React (图标)、Tippy.js (弹层) |
| 协同算法 | Yjs (CRDT) + y-websocket |
| 图表 | Mermaid、PlantUML (plantuml-encoder) |
| 导出/导入 | html2pdf.js、html-to-docx、mammoth、pdfjs-dist |
| 后端 | Python FastAPI + ypy-websocket |
| 数据库 | SQLAlchemy (async) + aiosqlite (SQLite) |

---

## 目录结构

```
doco/
├── src/
│   ├── main.tsx                       # 应用入口
│   ├── App.tsx                        # 根组件，路由管理，导入/导出，侧边栏
│   └── components/
│       ├── Sidebar.tsx                # 知识库侧边栏（文档树管理）
│       └── Editor/
│           ├── index.tsx              # 编辑器主组件（Yjs 初始化、所有扩展注册）
│           ├── BubbleMenu.tsx         # 选区浮动工具栏（行内格式化）
│           ├── BlockHandle.tsx        # 块级操作手柄（悬停菜单：转换/折叠/移动/复制/删除）
│           ├── CodeBlockComponent.tsx # 代码块（语言选择 + 复制 + 自动换行）
│           ├── MermaidBlock.ts        # Mermaid 图表节点定义
│           ├── MermaidComponent.tsx   # Mermaid 图表渲染（双击编辑、实时预览）
│           ├── PlantUMLBlock.ts       # PlantUML 图表节点定义
│           ├── PlantUMLComponent.tsx  # PlantUML 图表渲染
│           ├── CalloutBlock.ts        # 高亮块节点定义（emoji + color）
│           ├── CalloutComponent.tsx   # 高亮块渲染组件
│           ├── ResizableImage.ts      # 可调整大小的图片扩展（width + align）
│           ├── ImageComponent.tsx     # 图片渲染组件（拖拽缩放）
│           ├── CollapseExtension.ts   # 块折叠扩展（ProseMirror Plugin + Decoration）
│           ├── KeyboardShortcuts.ts   # 全局键盘快捷键扩展
│           ├── SlashCommand.ts        # / 命令扩展（支持 `/` 和 `、` 触发）
│           ├── suggestions.ts         # / 菜单列表数据 + Tippy.js 渲染
│           ├── CommandList.tsx         # / 菜单 UI 组件
│           ├── LinkPopover.tsx         # 链接编辑弹窗
│           ├── InlineMarkToolbar.tsx   # 行内标记工具栏
│           ├── TableToolbar.tsx        # 表格操作工具栏
│           ├── TableOfContents.tsx     # 目录生成组件
│           ├── DocSettings.tsx         # 文档设置面板（标题编号、背景色）
│           └── PasteMarkdownDialog.tsx # Markdown 粘贴检测与转换对话框
├── backend/
│   ├── main.py                        # FastAPI 服务入口（WebSocket + REST API）
│   ├── database.py                    # SQLAlchemy 异步数据库配置
│   ├── models.py                      # ORM 模型（KnowledgeBase/Folder/Document/YDocUpdate）
│   └── requirements.txt               # Python 依赖
└── src/index.css                      # 全局样式（ProseMirror、协同光标、折叠块）
```

---

## 核心功能

### 1. 编辑器扩展（`src/components/Editor/index.tsx`）

编辑器通过 `useEditor` 注册以下 Tiptap 扩展：

- **StarterKit**（禁用 history 和 codeBlock）：基础段落/标题/列表/引用/加粗/斜体等
- **CodeBlockLowlight** + 自定义 `CodeBlockComponent`：代码块语法高亮 + 语言选择 + 复制 + 自动换行
- **Underline / TextStyle / Color / Highlight / Link / TextAlign**：行内样式扩展
- **Placeholder**：空编辑器占位提示
- **TaskList / TaskItem**：带勾选框的任务列表（支持嵌套）
- **Markdown**（tiptap-markdown）：Markdown 序列化/反序列化
- **Table / TableRow / TableHeader / TableCell**：表格支持
- **MermaidBlock**：Mermaid 图表块级节点
- **PlantUMLBlock**：PlantUML 图表块级节点
- **CalloutBlock**：高亮块（带 emoji 和颜色属性）
- **ResizableImage**：可调整大小和对齐的图片扩展
- **CollapseExtension**：块折叠（ProseMirror Plugin + Decoration）
- **KeyboardShortcuts**：全局快捷键（块移动/复制/标题切换/对齐等）
- **SlashCommand**：`/` 和 `、` 命令面板
- **Collaboration**：Yjs 协同扩展（绑定 Y.Doc）

### 2. 协同编辑（Yjs）

```
前端 y-websocket (WebsocketProvider)
  ↕  binary CRDT 增量消息
后端 ypy-websocket (WebsocketServer) running in FastAPI
```

**关键实现要点：**

```python
# backend/main.py

# 路径提取必须健壮处理多段 URL (如 /ws/room-name)。
# ypy-websocket 将 path 作为房间 key，若提取不当会导致房间隔离或 403。
parts = self._websocket.url.path.strip("/").split("/")
room = parts[-1] if len(parts) > 1 else "default"

# 监控与调试：使用 logging 而非 print。
# ypy-websocket 数据是二进制二进制流，应监控数据包大小。
logger.info(f"[WS] Received {len(data)} bytes from {self.path}")
```

```tsx
// src/components/Editor/index.tsx

// 1. 生命周期管理：React 18 StrictMode 会双重挂载。
// 必须使用 useMemo 保持实例稳定，在卸载时调用 disconnect() 而非 destroy()。
// 直接 destroy() 会导致重新挂载后 Provider 变为不可用状态。
const ydoc = useMemo(() => new Y.Doc(), []);
const provider = useMemo(() => new WebsocketProvider('ws://...', 'room', ydoc, { connect: false }), [ydoc]);

useEffect(() => {
  provider.connect();
  return () => provider.disconnect(); // 仅断开连接，不销毁实例
}, [provider]);

// 2. Tiptap 扩展稳定性：使用 useMemo 稳定 extensions 数组，防止编辑器意外重载。
// 必须禁用 StarterKit 的原生 history，否则与 Collaboration 冲突。
const extensions = useMemo(() => [
  (StarterKit as any).configure({ history: false }), 
  Collaboration.configure({ document: ydoc, field: 'default' }),
  // ... 其他扩展
], [ydoc]);
```

> ⚠️ **重要**：React 18 StrictMode 下 cleanup 必须使用 `provider.disconnect()` 而非 `provider.destroy()`。
> `destroy()` 会调用 `doc.off('update', _updateHandler)` 移除更新监听器，导致 StrictMode 双重挂载后更新无法广播到服务器。
> `disconnect()` 只断开 WebSocket 连接，保留事件监听器，重新 `connect()` 后可正常工作。

> ⚠️ **注意**：`@tiptap/extension-collaboration-cursor`（协同光标）与 Tiptap v3 不兼容。
> Tiptap v3 的 Collaboration 使用了自己的 `y-tiptap` fork，而 CollaborationCursor 依赖原版 `y-prosemirror` 的 `ySyncPluginKey`，两者无法共存，当前项目未启用光标显示功能。

### 3. 浮动工具栏（`BubbleMenu.tsx`）

选中文本后自动弹出的行内格式工具栏，包含：加粗、斜体、下划线、删除线、行内代码、高亮、链接、左/居中/右对齐。支持键盘导航（↑↓ 切换，Enter/Space 执行）和快捷键提示。

### 4. 块操作手柄（`BlockHandle.tsx`）

鼠标悬停在块元素左侧显示操作菜单，功能包括：

- **转换为**：子菜单（正文、H1/H2/H3、无序/有序/任务列表、引用、代码块、高亮块、分隔线）
- **折叠/展开**（仅多行块）
- **剪切** (⌘X) / **复制** (⌘C) / **复制为纯文本** / **复制为 Markdown**
- **复制块** (⌘D) / **向上移动** (⌥↑) / **向下移动** (⌥↓)
- **在下方插入** (⌘⏎) / **删除** (Del)

通过 `editor.view.posAtCoords()` → `resolve()` → `before(depth)` 定位顶层块节点，支持完整键盘导航。

### 5. / 命令面板（`SlashCommand` / `suggestions.ts`）

输入 `/` 或 `、` 触发菜单，支持：H1/H2/H3、无序列表、任务列表、引用、代码块、图片、Mermaid 流程图、PlantUML 图、表格 (3×3)、高亮块、分隔线。

支持模糊搜索（含中文拼音缩写：yjbt=一级标题），使用 `tippy.js` 渲染下拉弹层。

### 6. 块折叠（`CollapseExtension.ts`）

基于 ProseMirror Plugin + Decoration 实现多行块折叠/展开：

- 折叠状态存储在 `editor.storage.collapse.collapsed` (Set\<number\>)
- 文档变更时自动映射折叠位置（`tr.mapping.map`）
- 点击折叠块自动展开
- CSS 类 `.doco-collapsed` 控制样式

### 7. 键盘快捷键（`KeyboardShortcuts.ts`）

| 快捷键 | 功能 |
|--------|------|
| ⌥↑/↓ | 向上/下移动当前块 |
| ⌘D | 复制当前块 |
| ⌘⏎ | 在下方插入新段落 |
| ⌘⇧H | 切换高亮 |
| ⌘⇧L/E/R | 左/居中/右对齐 |
| ⌘⌥1/2/3/0 | 切换 H1/H2/H3/正文 |
| ⌘⇧J | 切换标题多级编号 |
| ⌘K | 添加/编辑链接 |

### 8. 导出与导入

**导出**（通过 `forwardRef` + `useImperativeHandle` 暴露）：
- `exportMarkdown()`：序列化为 Markdown 文件下载
- `exportPDF()`：基于 `html2pdf.js` 导出 PDF
- `exportWord()`：基于 `html-to-docx` 生成 `.docx`

**导入**（`App.tsx`）：
- Markdown 文件（`.md`）
- Word 文件（`.docx`，通过 `mammoth` 转换）
- PDF 文件（`.pdf`，通过 `pdfjs-dist` 提取文本）

### 9. 知识库管理（`Sidebar.tsx` + 后端 REST API）

侧边栏提供知识库 → 文件夹 → 文档的树形管理，支持创建/重命名/删除/移动。

### 10. 文档设置（`DocSettings.tsx`）

文档级设置面板，支持标题多级编号（`heading_numbered`）和背景色（`bg_color`）。

### 11. 其他组件

- **TableToolbar**：表格操作工具栏（增删行列、合并单元格等）
- **TableOfContents**：根据标题自动生成目录
- **LinkPopover**：链接编辑弹窗（⌘K 触发）
- **PasteMarkdownDialog**：检测粘贴内容是否为 Markdown，提供转换选项
- **ResizableImage**：图片拖拽缩放 + 对齐（left/center/right）

---

## 启动方式

```bash
# 前端（Vite 开发服务器）
pnpm run dev

# 后端（Python WebSocket 协同服务器）
cd backend
source venv/bin/activate
python main.py
# 监听 http://0.0.0.0:8000，WebSocket 地址：ws://127.0.0.1:8000/ws/{room-name}
```

---

## 后端架构（`backend/`）

### 数据模型（`models.py`）

| 模型 | 说明 | 关键字段 |
|------|------|---------|
| KnowledgeBase | 知识库 | id, name |
| Folder | 文件夹（支持嵌套） | id, name, kb_id, parent_id |
| Document | 文档 | id (UUID/room name), title, folder_id, kb_id, heading_numbered, bg_color |
| YDocUpdate | Yjs 增量更新 | id, doc_id (索引), update (LargeBinary) |

### REST API 路由（`main.py`）

**知识库**：`GET/POST /api/kb`、`PATCH/DELETE /api/kb/{kb_id}`

**文件夹**：`GET /api/kb/{kb_id}/folders`、`GET /api/folders/{id}/subfolders`、`POST/PATCH/DELETE /api/folders`

**文档**：`GET /api/kb/{kb_id}/docs`、`GET /api/folders/{id}/docs`、`GET/POST/PATCH/DELETE /api/docs/{id}`、`GET /api/docs/{id}/path`

**搜索**：`GET /api/search/docs?q=...`（模糊搜索文档标题）

### 持久化机制（`DocoYStore`）

自定义 `DocoYStore(BaseYStore)` 将 Yjs 增量更新写入 SQLite：

```python
store = DocoYStore(room_name)
room = YRoom(ystore=store, ready=False)  # ready=False 防止加载时触发写入
await store.apply_updates(room.ydoc)      # 加载历史更新
room.ready = True                          # 开始监听新更新
```

> ⚠️ **踩坑记录**：不要用 `observe_after_transaction` 自定义持久化。
> ypy-websocket 的 `process_sync_message` 直接调用 `Y.apply_update`，触发的事务回调只有 2 字节空数据。
> 必须使用 YRoom 内置的 `ystore` 参数，让 `_broadcast_updates` 自动调用 `ystore.write()`。

---

## 开发规范

### 关键规则

1. **编辑器组件是独立包**：每次修改 `packages/editor/` 下的代码后，必须在该目录下运行 `pnpm run build` 编译。

2. **全局对话框必须使用 Portal**：任何全局覆盖的对话框（如 `DocHistory`）必须使用 `createPortal(content, document.body)` 挂载到 body，避免被父容器的 CSS（opacity/visibility/overflow）影响导致意外隐藏。

3. **Playwright 测试**：使用 Playwright 验证前端功能时，必须使用无头模式（headless），避免弹出浏览器窗口干扰用户。

---

## 已知问题 & 待办

- 协同光标（其他用户光标显示）暂未支持（与 Tiptap v3 不兼容，需自行实现）
- ydoc_updates 表会无限增长，需定期合并快照
