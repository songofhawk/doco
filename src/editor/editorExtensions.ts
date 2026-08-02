import type { Extension, Extensions } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { SlashCommand } from './components/SlashCommand'
import { MermaidBlock } from './components/MermaidBlock'
import { CalloutBlock } from './components/CalloutBlock'
import { PlantUMLBlock } from './components/PlantUMLBlock'
import { getSuggestionItems, renderItems } from './components/suggestions'
import { ResizableImage } from './components/ResizableImage'
import { CodeBlockComponent } from './components/CodeBlockComponent'
import { CollapseExtension } from './components/CollapseExtension'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { SpreadsheetBlock } from './components/SpreadsheetBlock'
import { ListNormalizationExtension } from './components/ListNormalizationExtension'
import { BlockIdExtension, DocoDocument } from './components/BlockIdExtension'
import { DocumentLimitExtension } from './documentLimits'
import type { EditorImageUploader } from './imageUtils'
import type { PlantUMLRenderer } from './plantUML'
import 'highlight.js/styles/github.css'

const lowlight = createLowlight(common)

export type DocoEditorExtensionOptions = {
    placeholder: string
    uploadImage?: EditorImageUploader | null
    resolveImageSrc?: (src: string, attachmentId?: string | null) => string
    undoRedo?: boolean
    beforeCustomExtensions?: Extension[]
    extraExtensions?: Extensions
    characterLimit?: number | false
    onLimit?: (limit: number) => void
    onCollapseChange?: (ids: string[]) => void
    renderPlantUML?: PlantUMLRenderer | null
}

/**
 * Doco 的纯前端 schema 与交互扩展集合。
 * 持久化或协同扩展通过 beforeCustomExtensions 注入，基础层不依赖任何后端协议。
 */
export function createDocoEditorExtensions({
    placeholder,
    uploadImage,
    resolveImageSrc = (src) => src,
    undoRedo = true,
    beforeCustomExtensions = [],
    extraExtensions,
    characterLimit = false,
    onLimit = () => undefined,
    onCollapseChange = () => undefined,
    renderPlantUML = null,
}: DocoEditorExtensionOptions): Extensions {
    const extensions: Extensions = [
        StarterKit.configure({
            document: false,
            codeBlock: false,
            undoRedo: undoRedo ? undefined : false,
            link: {
                openOnClick: false,
                HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
            },
        }),
        ...beforeCustomExtensions,
        CodeBlockLowlight.extend({
            addNodeView() {
                return ReactNodeViewRenderer(CodeBlockComponent)
            },
        }).configure({ lowlight }),
        TextStyle,
        Color,
        Highlight,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        DocoDocument,
        BlockIdExtension,
    ]

    if (characterLimit !== false) {
        extensions.push(DocumentLimitExtension.configure({ limit: characterLimit, onLimit }))
    }

    extensions.push(
        ResizableImage.configure({ inline: false, allowBase64: true, resolveSrc: resolveImageSrc }),
        Placeholder.configure({ placeholder }),
        TaskList,
        TaskItem.configure({ nested: true }),
        ListNormalizationExtension,
        Markdown,
        MermaidBlock,
        PlantUMLBlock.configure({ renderer: renderPlantUML }),
        CalloutBlock,
        SpreadsheetBlock,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        SlashCommand.configure({
            suggestion: {
                items: ({ query }: { query: string }) => getSuggestionItems({
                    query,
                    uploadImage,
                    plantUMLAvailable: Boolean(renderPlantUML),
                }),
                render: renderItems,
            },
        }),
        KeyboardShortcuts,
        CollapseExtension.configure({ onCollapseChange }),
    )

    if (extraExtensions) extensions.push(...extraExtensions)
    return extensions
}
