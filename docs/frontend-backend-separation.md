# Doco 前后端分离与编辑器组件独立化设计文档

## 1. 概述

本文档描述 Doco 项目从单体前端应用重构为 **pnpm monorepo** 架构的设计方案。核心目标有两个：

1. **前后端分离**：前端应用（App Shell）与后端服务（FastAPI）职责清晰划分，通过 REST API + WebSocket 通信
2. **编辑器组件独立化**：将富文本编辑器抽取为独立 npm 包 `@doco/editor`，可被任意 React 项目复用

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    doco (monorepo)                   │
│                                                     │
│  ┌──────────────┐          ┌──────────────────────┐ │
│  │  App Shell   │  import  │   @doco/editor       │ │
│  │  (src/)      │ -------> │   (packages/editor/) │ │
│  │              │          │                      │ │
│  │ - 路由       │          │ - Tiptap 编辑器核心  │ │
│  │ - 侧边栏    │          │ - 所有编辑器扩展     │ │
│  │ - 导入/导出  │          │ - 协同编辑 (Yjs)     │ │
│  │ - 文档管理   │          │ - UI 组件            │ │
│  └──────┬───────┘          └──────────────────────┘ │
│         │ REST API + WebSocket                      │
└─────────┼───────────────────────────────────────────┘
          │
  ┌───────▼───────────────────┐
  │      Backend (backend/)   │
  │                           │
  │  - FastAPI 服务           │
  │  - ypy-websocket 协同     │
  │  - SQLite 持久化          │
  │  - 知识库/文档 CRUD API   │
  └───────────────────────────┘
```

---

## 3. Monorepo 结构

采用 pnpm workspace 管理多包：

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```
doco/
├── pnpm-workspace.yaml
├── package.json                  # 根应用（App Shell）
├── src/                          # App Shell 源码
│   ├── main.tsx
│   ├── App.tsx                   # 路由、导入导出、侧边栏
│   ├── components/
│   │   └── Sidebar.tsx           # 知识库树形管理
│   └── index.css                 # 全局样式
├── packages/
│   └── editor/                   # @doco/editor 独立包
│       ├── package.json
│       ├── vite.config.ts        # 库模式构建配置
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          # 包入口，统一导出
│           ├── types.ts          # 类型定义
│           ├── DocoEditor.tsx    # 编辑器主组件
│           ├── components/       # 全部编辑器子组件
│           └── styles/
│               └── editor.css    # 编辑器样式
└── backend/                      # Python 后端（独立部署）
    ├── main.py
    ├── database.py
    ├── models.py
    └── requirements.txt
```

---

## 4. 编辑器包设计（@doco/editor）

### 4.1 包配置

```json
{
  "name": "@doco/editor",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./style.css": "./dist/style.css"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

设计要点：

- React 作为 `peerDependencies`，避免宿主应用出现多实例问题
- 编辑器相关依赖（Tiptap、Yjs、Mermaid 等）作为 `dependencies` 内聚在包内
- 样式通过 `./style.css` 子路径导出，宿主应用显式引入

### 4.2 构建策略

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        'react', 'react-dom', 'react/jsx-runtime',
        /^@tiptap\//,
        'yjs', 'y-websocket', 'y-indexeddb',
      ],
    },
    cssCodeSplit: false,  // 合并为单一 CSS 文件
    sourcemap: true,
  },
})
```

外部化策略：

| 类别 | 处理方式 | 原因 |
| ---- | -------- | ---- |
| React / ReactDOM | external | 宿主应用提供，避免多实例 |
| @tiptap/* | external | 宿主可能需要扩展，保持单例 |
| Yjs 生态 | external | CRDT 文档必须全局唯一实例 |
| Mermaid / highlight.js 等 | 打包 | 纯渲染依赖，无单例要求 |

### 4.3 组件 API 设计

编辑器对外暴露一个 `DocoEditor` 组件，通过 Props 接收配置，通过 Ref 暴露命令式方法。

#### Props 接口

```typescript
interface DocoEditorProps {
  docId: string                    // 文档唯一标识（同时作为协同房间名）
  initialMeta?: DocMeta            // 初始元数据（标题、编号、背景色）
  collaboration?: CollaborationConfig  // 协同配置（WebSocket 地址）
  onTitleChange?(docId: string, title: string): void      // 标题变更回调
  onSettingsChange?(docId: string, settings: Partial<DocMeta>): void  // 设置变更回调
  externalTitle?: string           // 外部标题覆盖（侧边栏重命名同步）
  extraExtensions?: Extensions     // 自定义 Tiptap 扩展注入
  placeholder?: string             // 占位提示文本
  className?: string               // 自定义 CSS 类
  style?: React.CSSProperties      // 内联样式
}
```

#### Ref 接口

```typescript
interface DocoEditorRef {
  importMarkdown(md: string): void   // 导入 Markdown 内容
  importHTML(html: string): void     // 导入 HTML 内容
  exportMarkdown(): void             // 导出为 Markdown 文件
  exportPDF(): void                  // 导出为 PDF 文件
  exportWord(): void                 // 导出为 Word 文件
  getEditor(): Editor | null         // 获取底层 Tiptap Editor 实例
}
```

#### 辅助类型

```typescript
interface DocMeta {
  title?: string
  headingNumbered?: boolean
  bgColor?: string
}

interface CollaborationConfig {
  websocketUrl: string
  roomName?: string    // 默认使用 docId
}
```

### 4.4 包内组件清单

编辑器包内聚了所有编辑相关的 UI 组件和 Tiptap 扩展：

| 组件/扩展 | 文件 | 职责 |
| ---- | ---- | ---- |
| DocoEditor | DocoEditor.tsx | 主组件，Yjs 初始化、扩展注册、生命周期管理 |
| FloatingToolbar | BubbleMenu.tsx | 选区浮动工具栏（行内格式化） |
| BlockHandle | BlockHandle.tsx | 块级操作手柄（转换/折叠/移动/复制/删除） |
| CodeBlockComponent | CodeBlockComponent.tsx | 代码块（语言选择 + 复制 + 自动换行） |
| MermaidBlock | MermaidBlock.ts | Mermaid 图表节点定义 |
| MermaidComponent | MermaidComponent.tsx | Mermaid 图表渲染（双击编辑） |
| PlantUMLBlock | PlantUMLBlock.ts | PlantUML 图表节点定义 |
| PlantUMLComponent | PlantUMLComponent.tsx | PlantUML 图表渲染 |
| CalloutBlock | CalloutBlock.ts | 高亮块节点定义（emoji + color） |
| CalloutComponent | CalloutComponent.tsx | 高亮块渲染组件 |
| ResizableImage | ResizableImage.ts | 可调整大小的图片扩展 |
| ImageComponent | ImageComponent.tsx | 图片渲染组件（拖拽缩放） |
| CollapseExtension | CollapseExtension.ts | 块折叠（ProseMirror Plugin + Decoration） |
| KeyboardShortcuts | KeyboardShortcuts.ts | 全局快捷键扩展 |
| SlashCommand | SlashCommand.ts | `/` 和 `、` 命令面板 |
| suggestions | suggestions.ts | 命令菜单数据 + Tippy.js 渲染 |
| CommandList | CommandList.tsx | 命令菜单 UI 组件 |
| LinkPopover | LinkPopover.tsx | 链接编辑弹窗 |
| InlineMarkToolbar | InlineMarkToolbar.tsx | 行内标记工具栏 |
| TableToolbar | TableToolbar.tsx | 表格操作工具栏 |
| TableOfContents | TableOfContents.tsx | 目录生成组件 |
| DocSettings | DocSettings.tsx | 文档设置面板 |
| PasteMarkdownDialog | PasteMarkdownDialog.tsx | Markdown 粘贴检测与转换 |

### 4.5 导出入口

```typescript
// packages/editor/src/index.ts
import './styles/editor.css'
export { DocoEditor } from './DocoEditor'
export type { DocoEditorProps, DocoEditorRef, DocMeta, CollaborationConfig } from './types'
```

仅导出组件和类型，样式通过 CSS 副作用自动注入。宿主应用也可通过 `@doco/editor/style.css` 显式引入。

---

## 5. App Shell 设计（src/）

重构后的 App Shell 不再包含任何编辑器逻辑，职责收敛为：

### 5.1 职责划分

| 职责 | 实现位置 | 说明 |
| ---- | -------- | ---- |
| 路由管理 | App.tsx | react-router-dom v7，`/` 和 `/doc/:id` |
| 知识库管理 | Sidebar.tsx | 知识库 → 文件夹 → 文档的树形 CRUD |
| 文档导入 | App.tsx | Markdown / Word / PDF 文件读取后调用 Ref 方法 |
| 文档导出 | App.tsx | 通过 Ref 调用编辑器的 export 方法 |
| 文档元数据 | App.tsx | 从后端 API 获取，传入编辑器 Props |
| 元数据持久化 | App.tsx | 通过回调接收编辑器变更，PATCH 到后端 |

### 5.2 集成示例

```tsx
import { DocoEditor } from '@doco/editor'
import '@doco/editor/style.css'

const EditorPage = () => {
  const { id } = useParams<{ id: string }>()
  const exportRef = useRef<DocoEditorRef>(null)

  return (
    <DocoEditor
      ref={exportRef}
      docId={id}
      key={id}
      initialMeta={meta}
      collaboration={{ websocketUrl: 'ws://127.0.0.1:8000/ws' }}
      onTitleChange={(docId, title) => {
        fetch(`/api/docs/${docId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title })
        })
      }}
      onSettingsChange={(docId, settings) => {
        fetch(`/api/docs/${docId}`, {
          method: 'PATCH',
          body: JSON.stringify(settings)
        })
      }}
    />
  )
}
```

---

## 6. 前后端通信设计

### 6.1 通信协议

```text
┌──────────┐   REST API (HTTP)    ┌──────────┐
│  App     │ ──────────────────>  │ Backend  │
│  Shell   │ <──────────────────  │ FastAPI  │
│          │                      │          │
│  @doco/  │   WebSocket (Yjs)    │ ypy-ws   │
│  editor  │ <==================> │          │
└──────────┘   binary CRDT 增量   └──────────┘
```

### 6.2 REST API（App Shell → Backend）

App Shell 通过 REST API 管理知识库元数据，编辑器本身不直接调用后端 API。

| 模块 | 端点 | 方法 | 说明 |
| ---- | ---- | ---- | ---- |
| 知识库 | /api/kb | GET / POST | 列表 / 创建 |
| 知识库 | /api/kb/{id} | PATCH / DELETE | 修改 / 删除 |
| 文件夹 | /api/kb/{id}/folders | GET | 获取知识库下文件夹 |
| 文件夹 | /api/folders | POST / PATCH / DELETE | 文件夹 CRUD |
| 文档 | /api/docs/{id} | GET / PATCH / DELETE | 文档元数据操作 |
| 搜索 | /api/search/docs?q= | GET | 模糊搜索文档标题 |

### 6.3 WebSocket 协同（@doco/editor → Backend）

编辑器内部通过 `y-websocket` 与后端 `ypy-websocket` 建立 WebSocket 连接，传输 Yjs CRDT 二进制增量。

连接地址格式：`ws://{host}/ws/{docId}`

数据流：

1. 编辑器创建 `Y.Doc` 实例和 `WebsocketProvider`
2. 连接建立后，服务端从 SQLite 加载历史增量并发送
3. 用户编辑产生的增量实时双向同步
4. 服务端通过 `DocoYStore` 将增量持久化到 `ydoc_updates` 表

---

## 7. 数据流与职责边界

```text
用户操作
  │
  ▼
┌─────────────────────────────────────────────┐
│  App Shell                                  │
│                                             │
│  ┌─────────┐    onTitleChange()    ┌──────┐ │
│  │Sidebar  │    onSettingsChange() │ REST │ │
│  │         │ ──────────────────>   │ API  │ │
│  └─────────┘                       └──────┘ │
│       │                               │     │
│       │ externalTitle                 │     │
│       ▼                               ▼     │
│  ┌──────────────────────────────────────┐   │
│  │  @doco/editor (DocoEditor)           │   │
│  │                                      │   │
│  │  Props 输入:                         │   │
│  │    docId, initialMeta, collaboration │   │
│  │                                      │   │
│  │  Ref 输出:                           │   │
│  │    import/export 方法                │   │
│  │                                      │   │
│  │  内部管理:                           │   │
│  │    Yjs 协同、扩展、UI 组件           │   │
│  └──────────────┬───────────────────────┘   │
│                 │ WebSocket (Yjs CRDT)       │
└─────────────────┼───────────────────────────┘
                  │
                  ▼
          ┌───────────────┐
          │    Backend    │
          └───────────────┘
```

核心原则：

- 编辑器是**纯 UI 组件**，不直接调用后端 API
- 元数据变更通过回调函数（`onTitleChange` / `onSettingsChange`）通知 App Shell
- App Shell 负责将变更持久化到后端
- 协同数据（Yjs CRDT）由编辑器内部直接与后端 WebSocket 通信，App Shell 不介入

---

## 8. 关键设计决策

### 8.1 为什么选择 pnpm workspace

- 本地包通过 `workspace:*` 协议引用，开发时无需发布即可实时联调
- pnpm 的硬链接机制避免依赖重复安装，节省磁盘空间
- 未来可扩展更多包（如 `@doco/shared`、`@doco/plugins`）

### 8.2 编辑器为什么用回调而非直接调 API

- 解耦：编辑器不需要知道后端地址、认证方式等细节
- 复用：不同宿主应用可能有不同的后端实现（REST / GraphQL / 本地存储）
- 测试：单元测试时只需 mock 回调函数，无需启动后端

### 8.3 协同连接为什么由编辑器内部管理

Yjs 的 `WebsocketProvider` 与 `Y.Doc` 生命周期强绑定，必须在同一作用域内创建和销毁。将协同逻辑放在编辑器内部可以：

- 保证 `Y.Doc` → `WebsocketProvider` → `Collaboration` 扩展三者生命周期一致
- 避免 React 18 StrictMode 双重挂载导致的连接泄漏（使用 `disconnect()` 而非 `destroy()`）
- 宿主应用只需传入 `websocketUrl`，无需理解 Yjs 内部机制

### 8.4 IndexedDB 离线缓存

编辑器内部集成了 `y-indexeddb`，为每个文档创建本地持久化：

```typescript
const idb = new IndexeddbPersistence(`doco-${docId}`, ydoc)
```

这使得用户在断网时仍可编辑，重新连接后自动通过 CRDT 合并同步。

---

## 9. 开发与构建流程

### 9.1 本地开发

```bash
# 安装依赖（自动链接 workspace 包）
pnpm install

# 启动编辑器包 watch 模式
cd packages/editor && pnpm run dev

# 启动 App Shell 开发服务器
pnpm run dev

# 启动后端
cd backend && source venv/bin/activate && python main.py
```

### 9.2 生产构建

```bash
# 构建编辑器包
cd packages/editor && pnpm run build

# 构建 App Shell（会自动使用编辑器包的 dist 产物）
pnpm run build
```

### 9.3 发布编辑器包（可选）

```bash
cd packages/editor
pnpm publish --access public
```

发布后，外部项目可通过 `npm install @doco/editor` 直接使用。

---

## 10. 已知限制与后续规划

| 项目 | 现状 | 后续方向 |
| ---- | ---- | -------- |
| 协同光标 | 未支持（`@tiptap/extension-collaboration-cursor` 与 Tiptap v3 不兼容） | 基于 ProseMirror Plugin 自行实现光标 Decoration |
| Yjs 增量存储 | `ydoc_updates` 表无限增长 | 定期合并快照，清理历史增量 |
| 编辑器主题 | 仅支持背景色切换 | 支持完整主题系统（暗色模式、自定义配色） |
| 协同地址配置 | 硬编码 `ws://127.0.0.1:8000/ws` | 支持环境变量或动态配置 |
| 包发布 | 仅 workspace 本地引用 | 配置 CI/CD 自动发布到 npm |
| 文档导入 | App Shell 负责文件解析 | 考虑将解析逻辑下沉到编辑器包 |
