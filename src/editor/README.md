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
import { useState } from 'react'
import { DocoTextEditor } from './editor/standalone'

export function DescriptionEditor() {
  const [markdown, setMarkdown] = useState('# 任务说明')

  return (
    <DocoTextEditor
      value={markdown}
      format="markdown"
      onChange={(snapshot) => setMarkdown(snapshot.markdown)}
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

## 内容与保存

- `format="tiptap-json"`：无损保留全部 Doco 节点，适合作为编辑态主格式。
- `format="markdown"`：适合 ClickUp 等只接收 Markdown 的后端。
- `format="html"`：适合普通富文本接口。
- `onChange` 同时返回 JSON、HTML、Markdown、纯文本和字符数；宿主自行决定防抖和保存策略。
- `ref.getJSON()` 可取得无损文档；`ref.getRootElement()` 可取得对应 DOM。

未来对接 ClickUp 时，建议以 Tiptap JSON 作为本地编辑态，通过 `ref.getJSON()` 找出 ClickUp 不支持的节点，再用节点的 `data-block-id` 在 `ref.getRootElement()` 中定位 DOM、渲染成图片、上传后替换成 Markdown 图片。这个转换属于 ClickUp Adapter，不应写进编辑器核心。

## 与 DocoEditor 的关系

`DocoEditor` 仍是 Doco 产品包装层，负责 IndexedDB、Yjs/Hocuspocus、标题、设置和导入导出。两个组件通过 `editorExtensions.ts` 共用同一套 schema 和基础交互，避免跨项目组件与 Doco 内部编辑器逐渐分叉。
