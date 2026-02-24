# Doco Editor — 项目说明

基于 **Tiptap (ProseMirror) + React + Vite** 的富文本协同编辑器，支持多端实时同步（Yjs CRDT），设计为可嵌入到其他项目的独立模块。

永远输出中文。
---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + Vite + TypeScript |
| CSS | Tailwind CSS v4 |
| 编辑器 | Tiptap v3（基于 ProseMirror） |
| 协同算法 | Yjs (CRDT) |
| 后端 | Python FastAPI + ypy-websocket |

---

## 目录结构

```
doco/
├── src/
│   ├── App.tsx                        # 根组件，挂载 Editor，提供导出按钮
│   └── components/Editor/
│       ├── index.tsx                  # 编辑器主组件（Yjs 初始化、所有扩展注册）
│       ├── BubbleMenu.tsx             # 选区浮动工具栏（行内格式化）
│       ├── BlockHandle.tsx            # 块级操作手柄（悬停显示 +/⠿ 菜单）
│       ├── CodeBlockComponent.tsx     # 代码块自定义节点（语言选择 + 复制）
│       ├── MermaidBlock.ts            # Mermaid 图表自定义节点定义
│       ├── MermaidComponent.tsx       # Mermaid 图表渲染组件
│       ├── SlashCommand.ts            # / 命令扩展配置
│       ├── suggestions.ts             # / 菜单列表数据 + Tippy.js 渲染
│       └── CommandList.tsx            # / 菜单 UI 组件
├── backend/
│   ├── main.py                        # FastAPI 服务入口（Yjs WebSocket 同步）
│   └── requirements.txt              # Python 依赖
└── index.css                          # 全局样式（ProseMirror、协同光标）
```

---

## 核心功能

### 1. 编辑器扩展（`src/components/Editor/index.tsx`）

编辑器通过 `useEditor` 注册以下 Tiptap 扩展：

- **StarterKit**：基础段落/标题/列表/引用/加粗/斜体等
- **CodeBlockLowlight** + 自定义 `CodeBlockComponent`：代码块语法高亮 + 语言选择 + 复制按钮
- **Underline / TextStyle / Color / Highlight / Link / TextAlign**：行内样式扩展
- **Placeholder**：空编辑器占位提示
- **TaskList / TaskItem**：带勾选框的任务列表（支持嵌套）
- **Markdown**（tiptap-markdown）：Markdown 序列化/反序列化
- **MermaidBlock**：Mermaid 图表块级节点
- **SlashCommand**：`/` 命令面板
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

选中文本后自动弹出的行内格式工具栏，包含：加粗、斜体、下划线、删除线、行内代码、高亮、链接、左/居中/右对齐。

### 4. 块操作手柄（`BlockHandle.tsx`）

鼠标悬停在块元素左侧会出现两个按钮：

- **`+`**：在下方插入新段落
- **`⠿`（六点拖拽图标）**：打开 Popover 菜单（剪切、复制、删除、在下方添加）

通过 `editor.view.posAtDOM()` 获取 ProseMirror 文档位置，再用 `editor.chain()` 执行操作。

### 5. / 命令面板（`SlashCommand` / `suggestions.ts`）

输入 `/` 触发菜单，支持：一级标题、二级标题、三级标题、无序列表、任务列表、引用、代码块、Mermaid 流程图。

使用 `tippy.js` 渲染下拉弹层，通过 Tiptap `suggestion` 扩展机制实现。

### 6. 导出功能

在 `Editor` 组件上通过 `forwardRef` + `useImperativeHandle` 暴露：

- `exportMarkdown()`：序列化为 Markdown 文件下载
- `exportPDF()`：基于 `html2pdf.js` 导出 PDF
- `exportWord()`：生成 `.doc`（HTML 包装为 Word 格式）

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

## 持久化机制（`DocoYStore`）

后端通过自定义 `DocoYStore` 类实现 Yjs 文档持久化：

```python
# backend/main.py

class DocoYStore(BaseYStore):
    """继承 ypy-websocket 的 BaseYStore，将更新写入 SQLite。"""

    async def write(self, data: bytes) -> None:
        if len(data) <= 2:  # 过滤空更新（Yjs 空状态为 2 字节）
            return
        # 写入 ydoc_updates 表

    async def read(self):
        # 异步生成器，按顺序 yield (update, metadata) 元组

# 房间初始化时使用内置 ystore 机制
store = DocoYStore(room_name)
room = YRoom(ystore=store, ready=False)  # ready=False 防止加载时触发写入
await store.apply_updates(room.ydoc)      # 加载历史更新
room.ready = True                          # 开始监听新更新
```

> ⚠️ **踩坑记录**：不要用 `observe_after_transaction` 自定义持久化。
> ypy-websocket 的 `process_sync_message` 直接调用 `Y.apply_update`，触发的事务回调只有 2 字节空数据。
> 必须使用 YRoom 内置的 `ystore` 参数，让 `_broadcast_updates` 自动调用 `ystore.write()`。

---

## 已知问题 & 待办

- 协同光标（其他用户光标显示）暂未支持（与 Tiptap v3 不兼容，需自行实现）
- ydoc_updates 表会无限增长，需定期合并快照
