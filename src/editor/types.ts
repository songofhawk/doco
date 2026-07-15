import type { Editor, Extensions } from '@tiptap/react'

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
  externalTitle?: string
  extraExtensions?: Extensions
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}
