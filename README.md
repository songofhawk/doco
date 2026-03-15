# Doco Editor

基于 Tiptap v3 + React 18 + Vite 的富文本协同编辑器，编辑器能力已直接集成在当前项目内，支持多端实时同步（Yjs CRDT）。

## 功能特性

- 富文本编辑：标题、列表、引用、任务列表、代码块（语法高亮）、表格、图片等
- 实时协同：基于 Yjs CRDT + WebSocket，多人同时编辑自动合并
- Markdown 支持：序列化/反序列化，支持粘贴 Markdown 内容
- 图表支持：Mermaid 流程图、PlantUML 图表
- 导出功能：Markdown / PDF / Word
- 斜杠命令面板、浮动工具栏、块操作手柄
- 文档持久化：后端 SQLite 存储 Yjs 增量更新

## 技术栈

| 层     | 技术                                            |
| ------ | ----------------------------------------------- |
| 前端   | React 18 + Vite + TypeScript + Tailwind CSS v4  |
| 编辑器 | Tiptap v3（ProseMirror）                         |
| 协同   | Yjs + y-websocket                                |
| 后端   | Python FastAPI + ypy-websocket + SQLite          |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm
- Python >= 3.9

### 前端

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev
```

### 后端

```bash
cd backend

# 创建虚拟环境并安装依赖
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 初始化数据库
python init_db.py

# 启动服务
python main.py
# WebSocket 地址：ws://127.0.0.1:8000/ws/{room-name}
```

### 构建部署

```bash
# 前端构建
pnpm run build
# 产物输出到 dist/，可部署到任意静态服务器（Nginx、Caddy 等）

# 后端部署
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

## 编辑器位置

Doco Editor 的核心组件位于 `src/editor/`，主应用直接从项目内部模块引用：

```tsx
import { DocoEditor } from './editor'

// DocoEditor 通过 forwardRef 暴露以下方法：
// - exportMarkdown()  导出 Markdown
// - exportPDF()       导出 PDF
// - exportWord()      导出 Word
const editorRef = useRef(null)

<DocoEditor ref={editorRef} docId="doc-001" />
```

使用时只需要配置好后端 WebSocket 服务地址，不再需要额外构建或发布独立 editor 包。

## 目录结构

```
doco/
├── src/
│   ├── App.tsx                          # 根组件
│   ├── main.tsx                         # 入口
│   ├── components/
│   │   └── Sidebar.tsx                  # 侧边栏
│   └── editor/
│       ├── index.ts                     # 编辑器入口
│       ├── DocoEditor.tsx               # 编辑器主组件（Yjs 初始化 + 扩展注册）
│       ├── components/
│       │   ├── BubbleMenu.tsx           # 选区浮动工具栏
│       │   ├── BlockHandle.tsx          # 块级操作手柄
│       │   ├── CodeBlockComponent.tsx   # 代码块（语法高亮 + 复制）
│       │   ├── MermaidBlock.ts          # Mermaid 节点定义
│       │   ├── MermaidComponent.tsx     # Mermaid 渲染
│       │   ├── PlantUMLBlock.ts         # PlantUML 节点定义
│       │   ├── PlantUMLComponent.tsx    # PlantUML 渲染
│       │   ├── SlashCommand.ts          # / 命令扩展
│       │   ├── suggestions.ts           # / 菜单数据
│       │   └── CommandList.tsx          # / 菜单 UI
│       └── styles/
│           └── editor.css               # 编辑器样式
├── backend/
│   ├── main.py                          # FastAPI 服务入口
│   ├── models.py                        # 数据模型
│   ├── database.py                      # 数据库配置
│   ├── init_db.py                       # 数据库初始化
│   └── requirements.txt                 # Python 依赖
└── index.css                            # 全局样式
```
