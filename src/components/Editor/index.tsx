import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { SlashCommand } from './SlashCommand'
import { MermaidBlock } from './MermaidBlock'
import { getSuggestionItems, renderItems } from './suggestions'
import { forwardRef, useImperativeHandle } from 'react'
import html2pdf from 'html2pdf.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import 'highlight.js/styles/github-dark.css'
import { Underline } from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { TextAlign } from '@tiptap/extension-text-align'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodeBlockComponent } from './CodeBlockComponent'
import { FloatingToolbar } from './BubbleMenu'
import { BlockHandle } from './BlockHandle'

const lowlight = createLowlight(common)

export const Editor = forwardRef((_props, ref) => {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                codeBlock: false,
            }),
            CodeBlockLowlight.extend({
                addNodeView() {
                    return ReactNodeViewRenderer(CodeBlockComponent as any)
                }
            }).configure({
                lowlight,
            }),
            Underline,
            TextStyle,
            Color,
            Highlight,
            Link.configure({ openOnClick: false }),
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
        ],
        content: '<h1>无标题文档</h1><p>尝试键入 / 调出菜单，选择「流程图 (Mermaid)」绘制网络结构图，或通过内置快捷键实现粗体、斜体。</p>',
        editorProps: {
            attributes: {
                class: 'focus:outline-none min-h-[500px] text-gray-800 leading-relaxed prose prose-blue sm:prose-base list-none tiptap-editor-container',
            },
        },
    })

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
