import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { SlashCommand } from './SlashCommand'
import { MermaidBlock } from './MermaidBlock'
import { getSuggestionItems, renderItems } from './suggestions'
import { forwardRef, useImperativeHandle, useEffect, useMemo } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import Collaboration from '@tiptap/extension-collaboration'
import html2pdf from 'html2pdf.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import 'highlight.js/styles/github-dark.css'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodeBlockComponent } from './CodeBlockComponent'
import { FloatingToolbar } from './BubbleMenu'
import { BlockHandle } from './BlockHandle'

const lowlight = createLowlight(common)

export const Editor = forwardRef(({ docId }: { docId: string }, ref) => {
    const ydoc = useMemo(() => new Y.Doc(), [docId])
    const provider = useMemo(() => {
        return new WebsocketProvider(
            'ws://127.0.0.1:8000/ws',
            docId || 'default-room',
            ydoc,
            { connect: false }
        )
    }, [ydoc, docId])

    useEffect(() => {
        provider.connect()
        return () => provider.disconnect()
    }, [provider])

    const extensions = useMemo(() => [
        (StarterKit as any).configure({
            codeBlock: false,
            history: false, // 禁用原生 history，交由 Collaboration 管理
        }),
        CodeBlockLowlight.extend({
            addNodeView() {
                return ReactNodeViewRenderer(CodeBlockComponent as any)
            }
        }).configure({
            lowlight,
        }),
        TextStyle,
        Color,
        Highlight,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Placeholder.configure({
            placeholder: '输入 / 唤起菜单，或直接开始写作...',
        }),
        TaskList,
        TaskItem.configure({
            nested: true,
        }),
        Markdown,
        MermaidBlock,
        SlashCommand.configure({
            suggestion: {
                items: getSuggestionItems,
                render: renderItems,
            },
        }),
        Collaboration.configure({
            document: ydoc,
            field: 'default',
            provider: provider,
        }),
    ], [ydoc, provider])

    const editor = useEditor({
        extensions,
        editorProps: {
            attributes: {
                class: 'focus:outline-none min-h-[500px] text-gray-800 leading-relaxed prose prose-blue sm:prose-base list-none tiptap-editor-container',
            },
        },
    }, [ydoc])

    useImperativeHandle(ref, () => ({
        exportMarkdown: () => {
            if (!editor) return
            const md = (editor.storage as any).markdown.getMarkdown()
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = 'document.md'
            link.click()
        },
        exportPDF: () => {
            const element = document.querySelector('.tiptap-editor-container')
            if (element) {
                html2pdf().from(element as HTMLElement).save('document.pdf')
            }
        },
        exportWord: async () => {
            if (!editor) return
            const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body>${editor.getHTML()}</body></html>`
            const blob = new Blob([html], { type: 'application/msword;charset=utf-8' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = 'document.doc'
            link.click()
        }
    }))

    return (
        <div className="w-full max-w-4xl mx-auto bg-white min-h-[80vh] shadow-sm rounded-lg mt-10 p-10 px-14 border border-gray-100 tiptap-editor-container relative group">
            {editor && <FloatingToolbar editor={editor} />}
            {editor && <BlockHandle editor={editor} />}
            <EditorContent editor={editor} />
        </div>
    )
})
