# DocoTextEditor

`DocoTextEditor` 是从 Doco 文档产品中拆出的纯前端富文本组件。它保留 Tiptap 编辑能力、快捷键、浮动工具栏、表格、Mermaid、PlantUML、Callout 和嵌入式表格，但不负责：

- 用户认证；
- 文档读取和保存；
- Yjs/Hocuspocus 协同；
- Doco 附件接口；
- 标题、文档历史、导入导出菜单等产品外壳。

跨项目打包时使用 `standalone.ts` 作为入口；不要以 `index.ts` 为入口，因为后者还导出了 Doco 产品使用的协同包装组件。

在本仓库运行 `pnpm run build:editor` 会生成 `dist-editor/`：入口 JS、`doco-text-editor.d.ts`、`style.css` 以及 Mermaid 的按需分块都在该目录中。复制或发布时必须保留整个目录；React 和 React DOM 由使用方提供。

## 最小用法

```tsx
import { useRef } from 'react'
import { DocoTextEditor, type DocoTextEditorRef } from 'doco-text-editor'
import 'doco-text-editor/style.css'

export function DescriptionEditor() {
  const editorRef = useRef<DocoTextEditorRef>(null)

  return (
    <DocoTextEditor
      ref={editorRef}
      defaultValue="# 任务说明"
      format="markdown"
      onChange={(change) => {
        // 高频回调只包含本次 ProseMirror 增量步骤。
        enqueueChanges(change.steps)
      }}
    />
  )
}
```

不传 `uploadImage` 时，图片会作为 data URL 嵌入文档，因此组件不需要后端也能工作。业务项目有附件服务时，应注入自己的上传函数：

```tsx
<DocoTextEditor
  defaultValue={{ type: 'doc', content: [] }}
  uploadImage={async (file) => {
    const result = await myAttachmentApi.upload(file)
    return { id: result.id, src: result.publicUrl }
  }}
/>
```

传入 `uploadImage={null}` 会关闭文件选择、图片拖放和图片粘贴。

纯组件默认不会请求任何 PlantUML 服务。需要该能力时，可以显式使用内置的公共服务适配器，或注入自己的渲染服务：

```tsx
import { DocoTextEditor, renderPlantUMLWithPublicServer } from './editor/standalone'

<DocoTextEditor renderPlantUML={renderPlantUMLWithPublicServer} />
```

涉及私密文档时应传入自托管实现，不要使用公共渲染服务。
仓库中的独立 Demo 为了展示完整能力，显式启用了上述公共服务适配器；正文内容仍只保存在浏览器 IndexedDB。

## 内容与保存

- `format="tiptap-json"`：无损保留全部 Doco 节点，适合作为编辑态主格式。
- `format="markdown"`：适合 ClickUp 等只接收 Markdown 的后端。
- `format="html"`：适合普通富文本接口。
- `onChange({ steps })` 只返回本次事务的 ProseMirror JSON 增量步骤，不在每次输入时生成整篇文档。
- `ref.getContent(format)` 按需取得完整内容，支持 `tiptap-json`、`markdown`、`html` 和 `text`。
- `ref.getRootElement()` 可取得对应 DOM。

```tsx
const json = editorRef.current?.getContent('tiptap-json')
const markdown = editorRef.current?.getContent('markdown')
const html = editorRef.current?.getContent('html')
const text = editorRef.current?.getContent('text')
```

如果后端只接受完整文档，可以在 `onChange` 中仅安排一次防抖保存，定时器真正执行时再调用
`getContent('tiptap-json')`；如果后端支持增量同步，则可以直接保存或传输 `steps`。

未来对接 ClickUp 时，建议以 Tiptap JSON 作为本地编辑态，通过 `ref.getContent('tiptap-json')` 找出 ClickUp 不支持的节点，再用节点的 `data-block-id` 在 `ref.getRootElement()` 中定位 DOM、渲染成图片、上传后替换成 Markdown 图片。这个转换属于 ClickUp Adapter，不应写进编辑器核心。

## 样式与主题

独立入口自带完整的编辑器 CSS、浏览器控件 reset 和纸张主题变量。使用构建产物时，宿主只需在应用入口引入一次 `style.css`，不需要为标题、引用、列表、代码块、表格或浮层重复编写样式。

默认主题定义在 `.doco-text-editor` 上；宿主可通过更具体的类名或组件 `style` 覆盖 `--surface-*`、`--border-*`、`--text-*`、`--accent`、`--font-ui` 和 `--font-heading` 等变量。

## 与 DocoEditor 的关系

`DocoEditor` 仍是 Doco 产品包装层，负责 IndexedDB、Yjs/Hocuspocus、标题、设置和导入导出。两个组件通过 `editorExtensions.ts` 共用同一套 schema 和基础交互，避免跨项目组件与 Doco 内部编辑器逐渐分叉。
