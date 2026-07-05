import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { SlashCommand } from './components/SlashCommand'
import { MermaidBlock } from './components/MermaidBlock'
import { CalloutBlock } from './components/CalloutBlock'
import { PlantUMLBlock } from './components/PlantUMLBlock'
import { getSuggestionItems, renderItems } from './components/suggestions'
import { forwardRef, useImperativeHandle, useEffect, useMemo, useState, useRef, useCallback } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { ResizableImage } from './components/ResizableImage'
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
import { CodeBlockComponent } from './components/CodeBlockComponent'
import { FloatingToolbar } from './components/BubbleMenu'
import { BlockHandle } from './components/BlockHandle'
import { CollapseExtension } from './components/CollapseExtension'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { InlineMarkToolbar } from './components/InlineMarkToolbar'
import { LinkPopover } from './components/LinkPopover'
import { DocSettings } from './components/DocSettings'
import { TableOfContents } from './components/TableOfContents'
import { TableToolbar } from './components/TableToolbar'
import { detectMarkdown, usePasteMarkdownDialog, PasteMarkdownDialog } from './components/PasteMarkdownDialog'
import { ListNormalizationExtension } from './components/ListNormalizationExtension'
import type { DocoEditorProps, DocoEditorRef, DocMeta } from './types'

const lowlight = createLowlight(common)

export const DocoEditor = forwardRef<DocoEditorRef, DocoEditorProps>(({
    docId, initialMeta, collaboration, onTitleChange, onSettingsChange,
    externalTitle, extraExtensions, placeholder: placeholderText, className, style
}, ref) => {
    const [title, setTitle] = useState('')
    const [wordCount, setWordCount] = useState(0)
    const [linkPopover, setLinkPopover] = useState<{ top: number; left: number; href: string } | null>(null)
    const [headingNumbered, setHeadingNumbered] = useState(false)
    const [bgColor, setBgColor] = useState('#ffffff')
    const titleTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const collapseTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const titleInputRef = useRef<HTMLTextAreaElement>(null)
    const pasteDialog = usePasteMarkdownDialog()

    // 保存文档设置
    const patchDocSettings = useCallback((patch: Partial<DocMeta>) => {
        onSettingsChange?.(docId, patch)
    }, [docId, onSettingsChange])

    const ydoc = useMemo(() => new Y.Doc(), [docId])
    // Hocuspocus 的文档名走协议消息而非 URL；socket 与 provider 分开持有，
    // StrictMode 下只做 connect/disconnect，不 destroy（保持实例可复用）
    const collab = useMemo(() => {
        if (!collaboration) return null
        const socket = new HocuspocusProviderWebsocket({
            url: collaboration.websocketUrl,
            connect: false,
        })
        const provider = new HocuspocusProvider({
            websocketProvider: socket,
            name: collaboration.roomName || docId,
            document: ydoc,
        })
        // 显式传入 websocketProvider 时不会自动 attach，必须手动调用
        provider.attach()
        return { socket, provider }
    }, [ydoc, docId, collaboration])

    useEffect(() => {
        const idb = new IndexeddbPersistence(`doco-${docId}`, ydoc)
        if (!collab) return () => { idb.destroy() }

        // IndexedDB 主存储先加载，再连服务器；初始状态互补由 SyncStep1/2 协议双向完成
        idb.once('synced', () => {
            collab.socket.connect()
        })

        return () => {
            collab.socket.disconnect()
            idb.destroy()
        }
    }, [collab, ydoc, docId])

    // 从 props 加载文档元数据
    useEffect(() => {
        if (initialMeta?.title) setTitle(initialMeta.title)
        if (initialMeta?.headingNumbered !== undefined) setHeadingNumbered(initialMeta.headingNumbered)
        if (initialMeta?.bgColor) setBgColor(initialMeta.bgColor)
    }, [docId, initialMeta])

    // 标题防抖保存
    const handleTitleChange = (newTitle: string) => {
        setTitle(newTitle)
        clearTimeout(titleTimerRef.current)
        titleTimerRef.current = setTimeout(() => {
            onTitleChange?.(docId, newTitle)
        }, 600)
    }

    // 监听外部标题变更
    useEffect(() => {
        if (externalTitle !== undefined) setTitle(externalTitle)
    }, [externalTitle])

    // 监听 Cmd+K 快捷键触发的链接编辑事件
    useEffect(() => {
        const handler = (e: Event) => {
            const { top, left, href } = (e as CustomEvent).detail
            setLinkPopover({ top, left, href })
        }
        window.addEventListener('editor-link-edit', handler)
        return () => window.removeEventListener('editor-link-edit', handler)
    }, [])

    // 监听 Cmd+Alt+Shift+J 快捷键切换标题编号
    useEffect(() => {
        const handler = () => setHeadingNumbered(v => {
            const next = !v
            patchDocSettings({ headingNumbered: next })
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

    // 折叠状态变更防抖保存（用 ref 稳定引用，避免 extensions 重建）
    const collapseChangeRef = useRef<(positions: number[]) => void>()
    collapseChangeRef.current = (positions: number[]) => {
        clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = setTimeout(() => {
            onSettingsChange?.(docId, { collapsedBlocks: positions })
        }, 800)
    }
    const handleCollapseChange = useCallback((positions: number[]) => {
        collapseChangeRef.current?.(positions)
    }, [])

    const extensions = useMemo(() => {
        const exts: any[] = [
            (StarterKit as any).configure({
                codeBlock: false,
                undoRedo: !collab,
            }),
        ]

        // Collaboration 必须在自定义节点之前注册
        if (collab) {
            exts.push(Collaboration.configure({ document: ydoc, field: 'default' }))
        }

        exts.push(
            CodeBlockLowlight.extend({
                addNodeView() {
                    return ReactNodeViewRenderer(CodeBlockComponent as any)
                }
            }).configure({ lowlight }),
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
                placeholder: placeholderText || '输入 / 唤起菜单，或直接开始写作...',
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            ListNormalizationExtension,
            Markdown,
            MermaidBlock,
            PlantUMLBlock,
            CalloutBlock,
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
            KeyboardShortcuts,
            CollapseExtension.configure({
                onCollapseChange: handleCollapseChange,
            }),
        )

        if (extraExtensions) exts.push(...extraExtensions)
        return exts
    }, [ydoc, collab, placeholderText, extraExtensions, handleCollapseChange])

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
                            editor.commands.insertContent(
                                (editor.storage as any).markdown.parser.parse(text)
                            )
                        } else if (editor) {
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

    // 从后端恢复折叠状态（需等 Yjs 文档同步完成后再执行）
    useEffect(() => {
        if (!editor || !initialMeta?.collapsedBlocks?.length) return
        const positions = initialMeta.collapsedBlocks
        const maxPos = Math.max(...positions)

        const tryRestore = () => {
            if (editor.state.doc.content.size > maxPos) {
                ;(editor.commands as any).setCollapsed(positions)
                return true
            }
            return false
        }

        // 文档可能已经加载好了（IndexedDB 离线缓存）
        if (tryRestore()) return

        // 否则等 Yjs 同步触发 editor update
        const onUpdate = () => {
            if (tryRestore()) editor.off('update', onUpdate)
        }
        editor.on('update', onUpdate)
        return () => { editor.off('update', onUpdate) }
    }, [editor, initialMeta])

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
        const tags = ['h1', 'h2', 'h3', 'h4']
        const used = tags.slice(minHeadingLevel - 1)
        const counterNames = used.map((_, i) => `hn${i + 1}`)

        let css = `.ProseMirror.heading-numbered {\n`
        css += `  counter-reset: ${counterNames.join(' ')};\n`
        used.forEach((tag, i) => {
            const resets = counterNames.slice(i + 1)
            if (resets.length) css += `  ${tag} { counter-reset: ${resets.join(' ')}; }\n`
        })
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
        },
        getEditor: () => editor,
    }))

    return (
        <div className={`doco-editor-root w-full max-w-4xl mx-auto min-h-[80vh] shadow-sm rounded-lg mt-6 p-10 px-14 border border-gray-100 relative group transition-colors ${className || ''}`}
            style={{ backgroundColor: bgColor, ...style }}
        >
            {/* 左侧目录导航 */}
            {editor && <TableOfContents editor={editor} headingNumbered={headingNumbered} />}
            {/* 文档设置按钮 */}
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <DocSettings
                    docId={docId}
                    headingNumbered={headingNumbered}
                    onToggleNumbered={() => setHeadingNumbered(v => {
                        const next = !v
                        patchDocSettings({ headingNumbered: next })
                        return next
                    })}
                    bgColor={bgColor}
                    onBgColorChange={(c: string) => {
                        setBgColor(c)
                        patchDocSettings({ bgColor: c })
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
