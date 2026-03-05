# @doco/editor API 文档

面向第三方开发人员的 `@doco/editor` 组件接入指南。

---

## 安装

```bash
npm install @doco/editor
# 或
pnpm add @doco/editor
```

**Peer Dependencies：**

- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## 快速开始

```tsx
import { DocoEditor } from '@doco/editor'
import '@doco/editor/style.css'

function App() {
  return (
    <DocoEditor
      docId="my-doc-001"
      initialMeta={{ title: '欢迎使用 Doco' }}
      onTitleChange={(docId, title) => {
        console.log(`文档 ${docId} 标题变更为: ${title}`)
      }}
    />
  )
}
```

---

## 导出内容

```ts
import { DocoEditor, DocoEditorRef } from '@doco/editor'
import '@doco/editor/style.css'
```

包导出以下内容：

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `DocoEditor` | React 组件 | 编辑器主组件（支持 `forwardRef`） |
| `DocoEditorProps` | TypeScript 类型 | 组件 Props 类型定义 |
| `DocoEditorRef` | TypeScript 类型 | 组件 Ref 方法类型定义 |
| `DocMeta` | TypeScript 类型 | 文档元数据类型 |
| `CollaborationConfig` | TypeScript 类型 | 协同编辑配置类型 |
| `@doco/editor/style.css` | CSS | 编辑器样式（必须引入） |

---

## DocoEditorProps

`DocoEditor` 组件接受以下 Props：

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `docId` | `string` | 是 | 文档唯一标识，用于协同房间名和数据持久化 key |
| `initialMeta` | `DocMeta` | 否 | 文档初始元数据（标题、设置等），打开文档时传入 |
| `collaboration` | `CollaborationConfig` | 否 | 协同编辑配置，不传则为单机模式（无 WebSocket 连接） |
| `onTitleChange` | `(docId: string, title: string) => void` | 否 | 标题变更回调（内置 600ms 防抖） |
| `onSettingsChange` | `(docId: string, settings: Partial<DocMeta>) => void` | 否 | 文档设置变更回调（标题编号、背景色、折叠状态等） |
| `externalTitle` | `string` | 否 | 外部控制标题，变更时会同步到编辑器标题栏 |
| `extraExtensions` | `Extensions` | 否 | 额外的 Tiptap 扩展，会追加到内置扩展列表之后 |
| `placeholder` | `string` | 否 | 编辑器空内容时的占位文本，默认 `"输入 / 唤起菜单，或直接开始写作..."` |
| `className` | `string` | 否 | 追加到编辑器根容器的 CSS 类名 |
| `style` | `React.CSSProperties` | 否 | 追加到编辑器根容器的内联样式 |

---

## DocMeta

文档元数据类型，用于 `initialMeta` 和 `onSettingsChange` 回调：

```ts
interface DocMeta {
  title?: string           // 文档标题
  headingNumbered?: boolean // 是否启用标题多级编号（1.1, 1.2...）
  bgColor?: string         // 文档背景色，CSS 颜色值，默认 '#ffffff'
  collapsedBlocks?: number[] // 折叠块的 ProseMirror 位置数组
}
```

---

## CollaborationConfig

协同编辑配置，传入后编辑器会通过 WebSocket 连接到 Yjs 协同服务器：

```ts
interface CollaborationConfig {
  websocketUrl: string  // WebSocket 服务地址，如 'ws://127.0.0.1:8000/ws'
  roomName?: string     // 协同房间名，默认使用 docId
}
```

不传 `collaboration` 时，编辑器以单机模式运行（仍有 IndexedDB 本地持久化）。

---

## DocoEditorRef

通过 `ref` 获取编辑器实例方法，用于导入/导出和直接操作编辑器：

```ts
interface DocoEditorRef {
  importMarkdown(md: string): void   // 导入 Markdown 内容到编辑器
  importHTML(html: string): void     // 导入 HTML 内容到编辑器
  exportMarkdown(): void             // 导出为 .md 文件并触发下载
  exportPDF(): void                  // 导出为 .pdf 文件并触发下载
  exportWord(): void                 // 导出为 .doc 文件并触发下载
  getEditor(): Editor | null         // 获取底层 Tiptap Editor 实例
}
```

使用示例：

```tsx
import { useRef } from 'react'
import { DocoEditor, DocoEditorRef } from '@doco/editor'
import '@doco/editor/style.css'

function App() {
  const editorRef = useRef<DocoEditorRef>(null)

  return (
    <>
      <div>
        <button onClick={() => editorRef.current?.exportMarkdown()}>
          导出 Markdown
        </button>
        <button onClick={() => editorRef.current?.exportPDF()}>
          导出 PDF
        </button>
        <button onClick={() => editorRef.current?.exportWord()}>
          导出 Word
        </button>
        <button onClick={() => {
          // 获取底层 Tiptap Editor 实例进行自定义操作
          const editor = editorRef.current?.getEditor()
          if (editor) {
            console.log(editor.getHTML())
          }
        }}>
          获取 HTML
        </button>
      </div>
      <DocoEditor ref={editorRef} docId="doc-001" />
    </>
  )
}
```

---

## 协同编辑接入

编辑器基于 Yjs CRDT + y-websocket 实现多端实时协同。传入 `collaboration` 配置即可启用。

### 基本用法

```tsx
<DocoEditor
  docId="doc-001"
  collaboration={{
    websocketUrl: 'ws://your-server.com/ws',
    roomName: 'doc-001',  // 可选，默认使用 docId
  }}
/>
```

### 协同协议

- 传输协议：WebSocket（二进制 CRDT 增量消息）
- 连接地址：`{websocketUrl}/{roomName}`，如 `ws://127.0.0.1:8000/ws/doc-001`
- 同步算法：Yjs CRDT，兼容任何 y-websocket 服务端实现
- 本地缓存：自动通过 IndexedDB 持久化（key 为 `doco-{docId}`），支持离线编辑

### 自建协同服务端

编辑器兼容任何标准 y-websocket 服务端。Doco 项目自带一个基于 Python FastAPI + ypy-websocket 的参考实现（见 `backend/` 目录），你也可以使用 Node.js 的 `y-websocket` 官方服务端。

---

## 后端 REST API 参考

以下是 Doco 后端提供的完整 REST API，供前端组件配合使用。基础地址默认为 `http://127.0.0.1:8000/api`。

所有请求和响应均为 JSON 格式（`Content-Type: application/json`）。

### 知识库 (Knowledge Base)

#### 获取知识库列表

```http
GET /api/kb
```

响应：

```json
[
  { "id": 1, "name": "我的知识库" }
]
```

#### 创建知识库

```http
POST /api/kb
```

请求体：

```json
{ "name": "新知识库" }
```

#### 重命名知识库

```http
PATCH /api/kb/{kb_id}
```

请求体：

```json
{ "name": "新名称" }
```

#### 删除知识库

```http
DELETE /api/kb/{kb_id}
```

删除知识库及其下所有文件夹和文档。

### 文件夹 (Folder)

#### 获取知识库下的顶层文件夹

```http
GET /api/kb/{kb_id}/folders
```

响应：

```json
[
  { "id": 1, "name": "设计文档", "kb_id": 1, "parent_id": null }
]
```

#### 获取子文件夹

```http
GET /api/folders/{folder_id}/subfolders
```

响应：同上，返回该文件夹下的直接子文件夹列表。

#### 创建文件夹

```http
POST /api/folders
```

请求体：

```json
{
  "name": "新文件夹",
  "kb_id": 1,
  "parent_id": null
}
```

`parent_id` 为 `null` 时创建在知识库根目录下，传入文件夹 ID 则创建为子文件夹。

#### 重命名文件夹

```http
PATCH /api/folders/{folder_id}
```

请求体：

```json
{ "name": "新名称" }
```

#### 删除文件夹

```http
DELETE /api/folders/{folder_id}
```

删除文件夹及其下所有子文件夹和文档。

### 文档 (Document)

#### 获取知识库下的直属文档

```http
GET /api/kb/{kb_id}/docs
```

响应：

```json
[
  { "id": "uuid-string", "title": "文档标题", "folder_id": null, "kb_id": 1 }
]
```

#### 获取文件夹下的文档

```http
GET /api/folders/{folder_id}/docs
```

响应：同上格式。

#### 获取文档详情

```http
GET /api/docs/{doc_id}
```

响应：

```json
{
  "id": "uuid-string",
  "title": "文档标题",
  "heading_numbered": false,
  "bg_color": "#ffffff",
  "collapsed_blocks": "1,5,12"
}
```

`collapsed_blocks` 为逗号分隔的 ProseMirror 位置字符串，可为空。

#### 创建文档

```http
POST /api/docs
```

请求体：

```json
{
  "id": "uuid-string",
  "title": "新文档",
  "folder_id": 1,
  "kb_id": 1
}
```

`id` 为客户端生成的 UUID，同时作为协同编辑的房间名。`folder_id` 和 `kb_id` 至少传一个。

#### 更新文档

```http
PATCH /api/docs/{doc_id}
```

请求体（所有字段均可选）：

```json
{
  "title": "新标题",
  "heading_numbered": true,
  "bg_color": "#f5f5f5",
  "collapsed_blocks": "1,5,12",
  "folder_id": 2,
  "kb_id": 1
}
```

此接口同时用于：标题修改、文档设置保存、文档移动（修改 `folder_id`/`kb_id`）。

#### 删除文档

```http
DELETE /api/docs/{doc_id}
```

#### 获取文档路径

```http
GET /api/docs/{doc_id}/path
```

响应：

```json
{
  "folder_id": 1,
  "kb_id": 1
}
```

用于根据文档 ID 反查其所属的知识库和文件夹，便于在侧边栏树中定位展开。

### 搜索

#### 模糊搜索文档

```http
GET /api/search/docs?q={query}
```

响应：

```json
[
  { "id": "uuid-string", "title": "匹配的文档标题" }
]
```

按文档标题进行模糊匹配，建议客户端做 300ms 防抖。

---

## 完整接入示例

以下示例展示如何将 `@doco/editor` 集成到你的应用中，配合后端 API 实现文档管理和协同编辑：

```tsx
import { useRef, useState, useEffect, useCallback } from 'react'
import { DocoEditor, DocoEditorRef, DocMeta } from '@doco/editor'
import '@doco/editor/style.css'

const API_BASE = 'http://127.0.0.1:8000/api'

function DocPage({ docId }: { docId: string }) {
  const editorRef = useRef<DocoEditorRef>(null)
  const [meta, setMeta] = useState<DocMeta>()

  // 加载文档元数据
  useEffect(() => {
    fetch(`${API_BASE}/docs/${docId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setMeta({
          title: d.title,
          headingNumbered: d.heading_numbered,
          bgColor: d.bg_color,
          collapsedBlocks: d.collapsed_blocks
            ? d.collapsed_blocks.split(',').filter(Boolean).map(Number)
            : [],
        })
      })
  }, [docId])

  // 标题变更 → 保存到后端
  const handleTitleChange = useCallback((id: string, title: string) => {
    fetch(`${API_BASE}/docs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  }, [])

  // 设置变更 → 保存到后端
  const handleSettingsChange = useCallback((id: string, settings: Partial<DocMeta>) => {
    const payload: Record<string, unknown> = {}
    if (settings.headingNumbered !== undefined) payload.heading_numbered = settings.headingNumbered
    if (settings.bgColor !== undefined) payload.bg_color = settings.bgColor
    if (settings.collapsedBlocks !== undefined) payload.collapsed_blocks = settings.collapsedBlocks.join(',')

    fetch(`${API_BASE}/docs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }, [])

  if (!meta) return <div>加载中...</div>

  return (
    <DocoEditor
      ref={editorRef}
      docId={docId}
      initialMeta={meta}
      collaboration={{ websocketUrl: 'ws://127.0.0.1:8000/ws' }}
      onTitleChange={handleTitleChange}
      onSettingsChange={handleSettingsChange}
    />
  )
}
```

---

## 内置功能

编辑器开箱即用，内置以下功能，无需额外配置：

### 富文本编辑

- 段落、标题（H1-H4）、引用、分隔线
- 加粗、斜体、下划线、删除线、行内代码、高亮、文字颜色
- 有序列表、无序列表、任务列表（支持嵌套）
- 表格（可调整列宽，支持增删行列、合并单元格）
- 代码块（语法高亮，支持语言选择、复制、自动换行）
- 可调整大小的图片（拖拽缩放 + 左/居中/右对齐）
- 链接编辑（Cmd+K 触发弹窗）

### 图表

- Mermaid 流程图（双击编辑，实时预览）
- PlantUML 图表

### 交互功能

- `/` 命令面板（输入 `/` 或 `、` 触发，支持模糊搜索和中文拼音缩写）
- 选区浮动工具栏（选中文本后自动弹出）
- 块操作手柄（鼠标悬停块左侧，支持转换、折叠、移动、复制、删除）
- 块折叠/展开（多行块支持折叠）
- 高亮块（Callout，带 emoji 和颜色）
- Markdown 粘贴检测（自动识别并提供转换选项）
- 图片拖拽粘贴（自动转为 Base64）

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+Up/Down` | 向上/下移动当前块 |
| `Cmd+D` | 复制当前块 |
| `Cmd+Enter` | 在下方插入新段落 |
| `Cmd+Shift+H` | 切换高亮 |
| `Cmd+Shift+L/E/R` | 左/居中/右对齐 |
| `Cmd+Alt+1/2/3/0` | 切换 H1/H2/H3/正文 |
| `Cmd+Shift+J` | 切换标题多级编号 |
| `Cmd+K` | 添加/编辑链接 |

### 文档设置

编辑器右上角悬停显示设置按钮，支持：

- 标题多级编号开关（自动生成 1.1、1.2 等编号）
- 文档背景色切换
