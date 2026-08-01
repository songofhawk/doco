/**
 * 纯前端入口：依赖图中不包含 Doco 的认证、REST API、Hocuspocus 或 IndexedDB 适配层。
 * 跨项目封装 npm/workspace 包时应以此文件作为 entry。
 */
import './standalone.css'

export { DocoTextEditor } from './DocoTextEditor'
export { embedEditorImage, fileToDataUrl } from './imageUtils'
export { PUBLIC_PLANTUML_SERVER, renderPlantUMLWithPublicServer } from './plantUML'
export type {
  DocoTextEditorFormat,
  DocoTextEditorProps,
  DocoTextEditorRef,
  DocoTextEditorSnapshot,
  DocoTextEditorValue,
} from './types'
export type { EditorImageUploader, UploadedEditorImage } from './imageUtils'
export type { PlantUMLRenderer } from './plantUML'
