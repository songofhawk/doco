import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { SlashCommand } from './SlashCommand'
import { MermaidBlock } from './MermaidBlock'
import { PlantUMLBlock } from './PlantUMLBlock'
import { getSuggestionItems, renderItems } from './suggestions'
import { forwardRef, useImperativeHandle, useEffect, useMemo, useState, useRef, useCallback } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import Collaboration from '@tiptap/extension-collaboration'
import Image from '@tiptap/extension-image'
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
    const [title, setTitle] = useState('')
    const [wordCount, setWordCount] = useState(0)
    const titleTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const titleInputRef = useRef<HTMLTextAreaElement>(null)

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
        const timer = setTimeout(() => provider.connect(), 0)
        return () => { clearTimeout(timer); provider.disconnect() }
    }, [provider])

    // 加载文档标题
    useEffect(() => {
        fetch(`http://127.0.0.1:8000/api/docs/${docId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.title) setTitle(d.title) })
            .catch(() => {})
    }, [docId])

    // 标题防抖保存
    const handleTitleChange = (newTitle: string) => {
        setTitle(newTitle)
        clearTimeout(titleTimerRef.current)
        titleTimerRef.current = setTimeout(() => {
            fetch(`http://127.0.0.1:8000/api/docs/${docId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            }).catch(() => {})
        }, 600)
    }

    // 标题输入框自动高度
    const autoResizeTitle = useCallback(() => {
        const el = titleInputRef.current
        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
    }, [])

    const extensions = useMemo(() => [
        (StarterKit as any).configure({
            codeBlock: false,
            undoRedo: false, // 禁用原生 history，交由 Collaboration 管理
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
        Image.configure({ inline: false, allowBase64: true }),
        Placeholder.configure({
            placeholder: '输入 / 唤起菜单，或直接开始写作...',
        }),
        TaskList,
        TaskItem.configure({
            nested: true,
        }),
        Markdown,
        MermaidBlock,
        PlantUMLBlock,
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
            handleDrop(view, event, _slice, moved) {
                if (moved || !event.dataTransfer?.files.length) return false
                const file = event.dataTransfer.files[0]
                if (!file.type.startsWith('image/')) return false
                event.preventDefault()
                const reader = new FileReader()
                reader.onload = () => {
                    const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })
                    if (!dropPos) return
                    editor?.chain().focus().insertContentAt(dropPos.pos, {
                        type: 'image',
                        attrs: { src: reader.result as string },
                    }).run()
                }
                reader.readAsDataURL(file)
                return true
            },
            handlePaste(_view, event) {
                const items = event.clipboardData?.items
                if (!items) return false
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        event.preventDefault()
                        const file = item.getAsFile()
                        if (!file) return false
                        const reader = new FileReader()
                        reader.onload = () => {
                            editor?.chain().focus().setImage({ src: reader.result as string }).run()
                        }
                        reader.readAsDataURL(file)
                        return true
                    }
                }
                return false
            },
        },
    }, [ydoc])

    // 字数统计
    useEffect(() => {
        if (!editor) return
        const update = () => {
            const text = editor.state.doc.textContent || ''
            setWordCount(text.replace(/\s/g, '').length)
        }
        update()
        editor.on('update', update)
        return () => { editor.off('update', update) }
    }, [editor])

    useImperativeHandle(ref, () => ({
        exportMarkdown: () => {
            if (!editor) return
            const md = (editor.storage as any).markdown.getMarkdown()
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = `${title || 'document'}.md`
            link.click()
        },
        exportPDF: () => {
            const element = document.querySelector('.tiptap-editor-container')
            if (element) {
                html2pdf().from(element as HTMLElement).save(`${title || 'document'}.pdf`)
            }
        },
        exportWord: async () => {
            if (!editor) return
            const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body>${editor.getHTML()}</body></html>`
            const blob = new Blob([html], { type: 'application/msword;charset=utf-8' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = `${title || 'document'}.doc`
            link.click()
        }
    }))

    return (
        <div className="w-full max-w-4xl mx-auto bg-white min-h-[80vh] shadow-sm rounded-lg mt-6 p-10 px-14 border border-gray-100 relative group">
            {/* 可编辑标题 */}
            <textarea
                ref={titleInputRef}
                value={title}
                onChange={e => { handleTitleChange(e.target.value); autoResizeTitle() }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start') } }}
                placeholder="无标题"
                rows={1}
                className="w-full text-3xl font-bold text-gray-900 border-none outline-none resize-none bg-transparent placeholder:text-gray-300 mb-4 leading-snug"
            />

            <div className="tiptap-editor-container">
                {editor && <FloatingToolbar editor={editor} />}
                {editor && <BlockHandle editor={editor} />}
                <EditorContent editor={editor} />
            </div>

            {/* 底部状态栏 */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex items-center text-xs text-gray-400">
                <span>{wordCount} 字</span>
            </div>
        </div>
    )
})
