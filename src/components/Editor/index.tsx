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
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { ResizableImage } from './ResizableImage'
import html2pdf from 'html2pdf.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import 'highlight.js/styles/github.css'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodeBlockComponent } from './CodeBlockComponent'
import { FloatingToolbar } from './BubbleMenu'
import { BlockHandle } from './BlockHandle'
import { CollapseExtension } from './CollapseExtension'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { InlineMarkToolbar } from './InlineMarkToolbar'
import { LinkPopover } from './LinkPopover'
import { DocSettings } from './DocSettings'
import { TableOfContents } from './TableOfContents'
import { TableToolbar } from './TableToolbar'
import { detectMarkdown, usePasteMarkdownDialog, PasteMarkdownDialog } from './PasteMarkdownDialog'

const lowlight = createLowlight(common)

export const Editor = forwardRef(({ docId }: { docId: string }, ref) => {
    const [title, setTitle] = useState('')
    const [wordCount, setWordCount] = useState(0)
    const [linkPopover, setLinkPopover] = useState<{ top: number; left: number; href: string } | null>(null)
    const [headingNumbered, setHeadingNumbered] = useState(false)
    const [bgColor, setBgColor] = useState('#ffffff')
    const titleTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const titleInputRef = useRef<HTMLTextAreaElement>(null)
    const pasteDialog = usePasteMarkdownDialog()

    // 保存文档设置到后端
    const patchDocSettings = useCallback((patch: Record<string, unknown>) => {
        fetch(`http://127.0.0.1:8000/api/docs/${docId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        }).catch(() => {})
    }, [docId])

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

    // 加载文档标题和设置
    useEffect(() => {
        fetch(`http://127.0.0.1:8000/api/docs/${docId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return
                if (d.title) setTitle(d.title)
                if (d.heading_numbered !== undefined) setHeadingNumbered(d.heading_numbered)
                if (d.bg_color) setBgColor(d.bg_color)
            })
            .catch(() => {})
    }, [docId])

    // 标题防抖保存 + 通知侧边栏同步
    const handleTitleChange = (newTitle: string) => {
        setTitle(newTitle)
        clearTimeout(titleTimerRef.current)
        titleTimerRef.current = setTimeout(() => {
            fetch(`http://127.0.0.1:8000/api/docs/${docId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            }).catch(() => {})
            window.dispatchEvent(new CustomEvent('doc-title-changed', { detail: { docId, title: newTitle } }))
        }, 600)
    }

    // 监听侧边栏重命名 → 同步编辑器标题
    useEffect(() => {
        const handler = (e: Event) => {
            const { docId: renamedId, title: newTitle } = (e as CustomEvent).detail
            if (renamedId === docId) setTitle(newTitle)
        }
        window.addEventListener('doc-renamed', handler)
        return () => window.removeEventListener('doc-renamed', handler)
    }, [docId])

    // 监听 Cmd+K 快捷键触发的链接编辑事件
    useEffect(() => {
        const handler = (e: Event) => {
            const { top, left, href } = (e as CustomEvent).detail
            setLinkPopover({ top, left, href })
        }
        window.addEventListener('editor-link-edit', handler)
        return () => window.removeEventListener('editor-link-edit', handler)
    }, [])

    // 监听 Cmd+Shift+N 快捷键切换标题编号
    useEffect(() => {
        const handler = () => setHeadingNumbered(v => {
            const next = !v
            patchDocSettings({ heading_numbered: next })
            return next
        })
        window.addEventListener('toggle-heading-numbered', handler)
        return () => window.removeEventListener('toggle-heading-numbered', handler)
    }, [patchDocSettings])

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
        Link.configure({
            openOnClick: false,
            HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        ResizableImage.configure({ inline: false, allowBase64: true }),
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
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
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
        KeyboardShortcuts,
        CollapseExtension,
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
                // 图片粘贴
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
                // Markdown 粘贴检测
                const text = event.clipboardData?.getData('text/plain') || ''
                if (text && detectMarkdown(text)) {
                    event.preventDefault()
                    pasteDialog.prompt(text).then((asRichText) => {
                        if (asRichText && editor) {
                            // 转换为富文本：通过 setContent 在当前光标位置插入解析后的内容
                            editor.commands.insertContent(
                                (editor.storage as any).markdown.parser.parse(text)
                            )
                        } else if (editor) {
                            // 以代码块插入
                            editor.commands.insertContent({
                                type: 'codeBlock',
                                attrs: { language: 'markdown' },
                                content: [{ type: 'text', text }],
                            })
                        }
                    })
                    return true
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

    // 同步标题编号：动态生成 CSS counter 规则适配最小标题级别
    const [minHeadingLevel, setMinHeadingLevel] = useState(1)
    useEffect(() => {
        const el = editor?.view?.dom
        if (!el) return
        el.classList.toggle('heading-numbered', headingNumbered)

        const detectMinLevel = () => {
            let min = 4
            editor.state.doc.descendants((node) => {
                if (node.type.name === 'heading' && node.attrs.level < min) {
                    min = node.attrs.level as number
                }
            })
            setMinHeadingLevel(prev => prev !== min ? min : prev)
        }
        detectMinLevel()
        editor.on('update', detectMinLevel)
        return () => { editor.off('update', detectMinLevel) }
    }, [editor, headingNumbered])

    // 注入动态 CSS counter 规则
    useEffect(() => {
        const styleId = 'doco-heading-numbering'
        let style = document.getElementById(styleId) as HTMLStyleElement | null
        if (!style) {
            style = document.createElement('style')
            style.id = styleId
            document.head.appendChild(style)
        }
        if (!headingNumbered) {
            style.textContent = ''
            return
        }
        // 根据 minHeadingLevel 生成 counter 规则
        // 例如 minLevel=2 时，h2 作为第一级，h3 作为第二级
        const tags = ['h1', 'h2', 'h3', 'h4']
        const used = tags.slice(minHeadingLevel - 1) // 从 minLevel 开始的标签
        const counterNames = used.map((_, i) => `hn${i + 1}`)

        let css = `.ProseMirror.heading-numbered {\n`
        css += `  counter-reset: ${counterNames.join(' ')};\n`
        // 每级标题重置下级计数器
        used.forEach((tag, i) => {
            const resets = counterNames.slice(i + 1)
            if (resets.length) css += `  ${tag} { counter-reset: ${resets.join(' ')}; }\n`
        })
        // 每级标题的 ::before 编号
        used.forEach((tag, i) => {
            const parts = counterNames.slice(0, i + 1).map(c => `counter(${c})`).join(' "."')
            const suffix = i === 0 ? ' ". "' : ' " "'
            css += `  ${tag}::before {\n`
            css += `    counter-increment: ${counterNames[i]};\n`
            css += `    content: ${parts}${suffix};\n`
            css += `    color: #9ca3af; margin-right: 0.5rem;\n`
            css += `  }\n`
        })
        css += `}`
        style.textContent = css
        return () => { style!.textContent = '' }
    }, [headingNumbered, minHeadingLevel])

    useImperativeHandle(ref, () => ({
        importMarkdown: (markdown: string) => {
            if (!editor) return
            editor.commands.setContent(markdown)
        },
        importHTML: (html: string) => {
            if (!editor) return
            editor.commands.setContent(html)
        },
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
        <div className="w-full max-w-4xl mx-auto min-h-[80vh] shadow-sm rounded-lg mt-6 p-10 px-14 border border-gray-100 relative group transition-colors"
            style={{ backgroundColor: bgColor }}
        >
            {/* 左侧目录导航 — 绝对定位在卡片左侧外部 */}
            {editor && <TableOfContents editor={editor} headingNumbered={headingNumbered} />}
            {/* 文档设置按钮 */}
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <DocSettings
                    headingNumbered={headingNumbered}
                    onToggleNumbered={() => setHeadingNumbered(v => {
                        const next = !v
                        patchDocSettings({ heading_numbered: next })
                        return next
                    })}
                    bgColor={bgColor}
                    onBgColorChange={(c: string) => {
                        setBgColor(c)
                        patchDocSettings({ bg_color: c })
                    }}
                />
            </div>

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

            <div className="tiptap-editor-container relative">
                {editor && <FloatingToolbar editor={editor} />}
                {editor && <BlockHandle editor={editor} />}
                {editor && <InlineMarkToolbar editor={editor} />}
                {editor && <TableToolbar editor={editor} />}
                {editor && linkPopover && (
                    <LinkPopover
                        editor={editor}
                        pos={linkPopover}
                        initialUrl={linkPopover.href}
                        isEdit={editor.isActive('link')}
                        onClose={() => setLinkPopover(null)}
                    />
                )}
                <EditorContent editor={editor} />
            </div>

            {/* Markdown 粘贴提示弹窗 */}
            <PasteMarkdownDialog
                visible={pasteDialog.state.visible}
                text={pasteDialog.state.text}
                onChoice={pasteDialog.handleChoice}
            />

            {/* 底部状态栏 */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex items-center text-xs text-gray-400">
                <span>{wordCount} 字</span>
            </div>
        </div>
    )
})
