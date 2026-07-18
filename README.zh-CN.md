# Doco

> 📖 [English](README.md)

一个把数据交回你手上的开源富文本协同编辑器——支持实时协同、知识库管理、文本绘图、电子表格与多格式导出。

![](docs/assets/readme/product-editor.png)

## 特性

### 编辑体验

- **富文本编辑**：标题、列表、引用、任务列表、代码块（语法高亮）、表格、图片、链接、文字样式等
- **`/` 斜杠命令**：输入 `/` 弹出命令面板，支持中文拼音缩写模糊搜索——`lct` 插入流程图，`dmk` 插入代码块
- **浮动工具栏**：选中文字自动弹出，格式化操作触手可及
- **块级拖拽**：悬停段落左侧显示拖拽手柄，像搭积木一样调整内容顺序
- **长文折叠**：暂时不写的章节一键收起，折叠状态持久化
- **标题自动编号**：一键开启，H1~H4 按层级自动维护 `1.` `1.1` `1.1.1` 编号
- **键盘快捷键**：`⌥↑/↓` 移动段落、`⌘D` 复制块、`⌘⌥1/2/3/0` 切换标题级别

### 文本绘图

在文档中直接写 Mermaid 或 PlantUML 源码，图表自动渲染。双击编辑、全屏查看、拖拽缩放，告别 draw.io 的导出-导入-替换流程。

- **Mermaid**：流程图、时序图、类图、甘特图、状态图等
- **PlantUML**：时序图、类图、用例图、组件图等

### 电子表格

嵌入文档的完整电子表格引擎：
- 公式计算、单元格格式化
- 冻结表头、排序筛选
- 单元格合并/拆分
- CSV 导入导出

可以作为文档内容块嵌入，也可以独立全屏打开。

### 知识库管理

- 知识库 → 文件夹（可嵌套）→ 文档，三级结构
- 侧边栏拖拽排序、重命名、移动
- 知识库级 ZIP 导出（保留文件夹层级，图片一并打包）

### 协同编辑

基于 Yjs CRDT 算法，支持多人实时协同：
- 无需保存按钮，修改自动同步
- 断网不影响编辑（浏览器 IndexedDB 为主存储），恢复后自动合并差异
- 跨设备无缝切换：电脑写一半，手机接着写

### 导入 / 导出

| 格式 | 导入 | 导出 |
|------|------|------|
| Markdown | ✅ 粘贴 / 文件上传 | ✅ 单篇 & 知识库打包 |
| Word (DOCX) | ✅ | ✅ |
| PDF | ✅ | ✅ |
| HTML | ✅ | — |
| 微信公众号 | — | ✅（带主题预览） |
| 图片（文档内） | ✅（粘贴 / 拖拽） | ✅（ZIP 打包附带） |

### API

暴露完整的 REST API（OpenAPI 3.1 规范，Bearer Token 认证，ETag 版本控制）。把文档变成可编程的信息资产——脚本自动备份、Agent 整理知识库、发布流程中同步文档到博客。

API 文档页面内置于编辑器，打开即用。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + Vite + TypeScript |
| CSS | Tailwind CSS v4 |
| 编辑器 | Tiptap v3（ProseMirror） |
| 协同算法 | Yjs (CRDT) + Hocuspocus |
| 图表 | Mermaid + PlantUML |
| 后端 | Node.js + Express + Hocuspocus Server |
| 数据库 | better-sqlite3（SQLite，WAL 模式） |
| UI 组件 | Radix UI、Lucide React、Tippy.js |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm

### 安装与启动

```bash
# 安装前端依赖
pnpm install

# 安装后端依赖
cd backend && npm install && cd ..

# 启动前端开发服务器（Vite，默认 :5173）
pnpm run dev

# 另开终端，启动后端（Express + WebSocket，默认 :8000）
cd backend
npm run dev
```

前端启动后访问 `http://localhost:5173`，会自动连接后端 WebSocket 服务。

### 构建与部署

```bash
# 前端构建
pnpm run build          # 产物 → dist/
pnpm run deploy         # 部署到 Cloudflare Pages

# 后端部署
cd backend
npm start               # 生产环境启动
```

## 项目结构

```
doco/
├── src/
│   ├── main.tsx                      # 应用入口
│   ├── App.tsx                       # 根组件，路由管理，导入/导出
│   ├── components/
│   │   └── Sidebar.tsx               # 知识库侧边栏（文档树管理）
│   └── editor/                       # 编辑器模块
│       ├── index.ts                  # 入口，导出 DocoEditor 组件
│       ├── DocoEditor.tsx            # 编辑器主组件（Yjs/Hocuspocus 初始化、扩展注册）
│       ├── types.ts                  # DocoEditor Props/Ref 类型定义
│       └── components/
│           ├── BubbleMenu.tsx        # 选区浮动工具栏
│           ├── BlockHandle.tsx       # 块级拖拽手柄
│           ├── SlashCommand.ts       # / 命令面板
│           ├── CommandList.tsx       # 命令面板 UI
│           ├── suggestions.ts        # 命令菜单数据
│           ├── CollapseExtension.ts  # 块折叠扩展
│           ├── DocSettings.tsx       # 文档设置（标题编号、背景色）
│           ├── MermaidBlock.ts       # Mermaid 节点定义
│           ├── MermaidComponent.tsx  # Mermaid 渲染组件
│           ├── PlantUMLBlock.ts      # PlantUML 节点定义
│           ├── PlantUMLComponent.tsx # PlantUML 渲染组件
│           ├── CalloutBlock.ts       # Callout 块定义
│           ├── CalloutComponent.tsx  # Callout 渲染组件
│           ├── SpreadsheetBlock.ts   # 电子表格节点定义
│           ├── SpreadsheetComponent.tsx  # 电子表格渲染组件
│           ├── spreadsheetEngine.ts  # 电子表格计算引擎
│           ├── WeChatExportDialog.tsx # 微信公众号导出
│           ├── KeyboardShortcuts.ts  # 键盘快捷键
│           ├── TableOfContents.tsx   # 目录
│           ├── CodeBlockComponent.tsx # 代码块（高亮 + 复制）
│           └── ImageComponent.tsx    # 图片渲染
├── backend/
│   ├── server.js                     # 入口：Express + Hocuspocus + 导出路由
│   ├── database.js                   # better-sqlite3 初始化与建表
│   ├── api.js                        # 知识库/文件夹/文档 REST API
│   ├── auth.js                       # 认证（OAuth + 邮箱 + API Token）
│   ├── markdown.js                   # YDoc → Markdown 服务端导出
│   ├── permissions.js                # 权限管理
│   ├── quota.js                      # 配额管理
│   ├── openapi.js                    # OpenAPI 规范定义
│   └── tests/                        # 后端测试
└── docs/                             # 设计文档与方案
```

## 编辑器组件用法

```tsx
import { DocoEditor } from './editor'
import type { DocoEditorRef } from './editor/types'

const editorRef = useRef<DocoEditorRef>(null)

<DocoEditor
  ref={editorRef}
  docId="doc-001"
  userId="user-001"
  collaboration={{
    websocketUrl: 'ws://localhost:8000',
  }}
  onTitleChange={(docId, title) => console.log('标题变更:', title)}
  placeholder="开始写作…"
/>

{/* 通过 ref 调用导出方法 */}
<button onClick={() => editorRef.current?.exportMarkdown()}>导出 MD</button>
```

## 协同编辑架构

```
前端 IndexedDB (y-indexeddb)  ← 本地主存储
       ↕
前端 Y.Doc  ← @hocuspocus/provider (WebSocket)
       ↕  Yjs 二进制增量消息
后端 @hocuspocus/server  →  SQLite ydoc_state（每文档一行合并快照）
```

- 浏览器 IndexedDB 是主存储，后端快照为辅助。后端缺失时在前端打开文档即可自动回传补全。
- 断网不影响编辑，网络恢复后自动同步差异。
- 协同光标：框架支持，当前未默认启用。

## Markdown 导出

单文档和知识库打包均支持 Markdown 导出，由服务端从 YDoc 实时生成：

```bash
# 单文档导出
curl http://localhost:8000/api/docs/{id}/export.md

# 知识库 ZIP 打包
curl http://localhost:8000/api/kb/{id}/export.zip
```

前端自定义节点（Mermaid、PlantUML、Callout 等）在 `backend/markdown.js` 中有对应的序列化规则。新增自定义节点时需同步更新。

## License

MIT
