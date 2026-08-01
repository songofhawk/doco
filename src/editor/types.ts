import type { JSONContent } from '@tiptap/core'
import type { Editor, Extensions } from '@tiptap/react'
import type { CSSProperties } from 'react'
import type { EditorImageUploader } from './imageUtils'
import type { PlantUMLRenderer } from './plantUML'

export interface DocMeta {
  title?: string
  headingNumbered?: boolean
  bgColor?: string
  collapsedBlocks?: string[]
}

export interface CollaborationConfig {
  websocketUrl: string
  roomName?: string
}

export interface DocoEditorRef {
  importMarkdown(md: string): void
  importHTML(html: string): void
  exportMarkdown(): void
  exportPDF(): void
  exportWord(): void
  getEditor(): Editor | null
}

export interface DocoEditorProps {
  docId: string
  userId?: string
  initialMeta?: DocMeta
  collaboration?: CollaborationConfig
  onTitleChange?(docId: string, title: string): void
  onSettingsChange?(docId: string, settings: Partial<DocMeta>): void
  onImportRequest?(format: 'document' | 'doco'): void
  onNativeExportRequest?(docId: string): void
  externalTitle?: string
  extraExtensions?: Extensions
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}

export type DocoTextEditorFormat = 'tiptap-json' | 'html' | 'markdown'
export type DocoTextEditorValue = string | JSONContent

export interface DocoTextEditorSnapshot {
  json: JSONContent
  html: string
  markdown: string
  text: string
  characterCount: number
}

export interface DocoTextEditorRef {
  focus(position?: 'start' | 'end'): void
  clear(): void
  setContent(value: DocoTextEditorValue, format?: DocoTextEditorFormat): void
  getJSON(): JSONContent | null
  getHTML(): string
  getMarkdown(): string
  getText(): string
  getEditor(): Editor | null
  getRootElement(): HTMLDivElement | null
}

export interface DocoTextEditorProps {
  /** 受控内容；异步加载完成后可以直接传入。 */
  value?: DocoTextEditorValue
  /** 非受控初始内容，仅在首次挂载时读取。 */
  defaultValue?: DocoTextEditorValue
  format?: DocoTextEditorFormat
  editable?: boolean
  placeholder?: string
  onChange?(snapshot: DocoTextEditorSnapshot): void
  onReady?(editor: Editor): void
  onBlur?(snapshot: DocoTextEditorSnapshot): void
  onError?(error: Error): void
  /** undefined 时以内嵌 data URL 保存图片；null 时关闭本地图片选择、拖放与粘贴。 */
  uploadImage?: EditorImageUploader | null
  /** 将持久化层中的图片属性解析成浏览器可显示地址。 */
  resolveImageSrc?(src: string, attachmentId?: string | null): string
  /** 默认不联网；需要 PlantUML 时由宿主注入渲染函数。 */
  renderPlantUML?: PlantUMLRenderer | null
  extraExtensions?: Extensions
  characterLimit?: number | false
  showStatusBar?: boolean
  showFloatingToolbar?: boolean
  showBlockHandle?: boolean
  showInlineToolbar?: boolean
  showTableToolbar?: boolean
  className?: string
  editorClassName?: string
  style?: CSSProperties
}
