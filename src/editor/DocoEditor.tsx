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
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodeBlockComponent } from './components/CodeBlockComponent'
import { FloatingToolbar } from './components/BubbleMenu'
import { BlockHandle } from './components/BlockHandle'
import { CollapseExtension } from './components/CollapseExtension'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { InlineMarkToolbar } from './components/InlineMarkToolbar'
import { LinkPopover } from './components/LinkPopover'
import { DocSettings } from './components/DocSettings'
import { ChevronDown, Download, Upload } from 'lucide-react'
import { TableOfContents } from './components/TableOfContents'
import { TableToolbar } from './components/TableToolbar'
import { SpreadsheetBlock } from './components/SpreadsheetBlock'
import { detectMarkdown, usePasteMarkdownDialog, PasteMarkdownDialog } from './components/PasteMarkdownDialog'
import { WeChatExportDialog } from './components/WeChatExportDialog'
import { ListNormalizationExtension } from './components/ListNormalizationExtension'
import { BlockIdExtension, DocoDocument } from './components/BlockIdExtension'
import { countVisibleCharacters, DOCUMENT_CHARACTER_LIMIT, DocumentLimitExtension } from './documentLimits'
import type { DocoEditorProps, DocoEditorRef, DocMeta } from './types'

const lowlight = createLowlight(common)

export const DocoEditor = forwardRef<DocoEditorRef, DocoEditorProps>(({
    docId, userId, initialMeta, collaboration, onTitleChange, onSettingsChange,
    onImportRequest, externalTitle, extraExtensions, placeholder: placeholderText, className, style
}, ref) => {
    const [title, setTitle] = useState('')
    const [wordCount, setWordCount] = useState(0)
    const [linkPopover, setLinkPopover] = useState<{ top: number; left: number; href: string } | null>(null)
    const [headingNumbered, setHeadingNumbered] = useState(false)
    const [bgColor, setBgColor] = useState('#ffffff')
    const titleTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const collapseTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const collaborationProviderRef = useRef<HocuspocusProvider | null>(null)
    const saveRequestRef = useRef<string | null>(null)
    const titleInputRef = useRef<HTMLTextAreaElement>(null)
    const exportMenuRef = useRef<HTMLDivElement>(null)
    const [exportOpen, setExportOpen] = useState(false)
    const [wechatExportOpen, setWechatExportOpen] = useState(false)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [limitMessage, setLimitMessage] = useState('')
    const pasteDialog = usePasteMarkdownDialog()
    const isCollaborative = Boolean(collaboration?.websocketUrl)
    const websocketUrl = collaboration?.websocketUrl
    const roomName = collaboration?.roomName || docId
    const persistenceKey = `doco-${userId || 'anonymous'}-${docId}`
    const [readyPersistenceKey, setReadyPersistenceKey] = useState<string | null>(null)
    const isPersistenceReady = !isCollaborative || readyPersistenceKey === persistenceKey

    useEffect(() => {
        if (!exportOpen) return
        const handleOutsideClick = (event: MouseEvent) => {
            if (!exportMenuRef.current?.contains(event.target as Node)) setExportOpen(false)
        }
        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [exportOpen])

    // 保存文档设置
    const patchDocSettings = useCallback((patch: Partial<DocMeta>) => {
        onSettingsChange?.(docId, patch)
    }, [docId, onSettingsChange])

    const ydoc = useMemo(() => new Y.Doc(), [docId])

    useEffect(() => {
        const idb = new IndexeddbPersistence(persistenceKey, ydoc)
        let disposed = false
        let connectTimer: ReturnType<typeof setTimeout> | undefined
        let socket: HocuspocusProviderWebsocket | null = null
        let provider: HocuspocusProvider | null = null

        if (!websocketUrl) return () => { idb.destroy() }

        // Hocuspocus 的文档名走协议消息而非 URL；socket 与 provider 分开持有。
        // provider/socket 的创建有事件监听副作用，必须放在 effect 生命周期里。
        socket = new HocuspocusProviderWebsocket({
            url: websocketUrl,
            autoConnect: false,
        })
        provider = new HocuspocusProvider({
            websocketProvider: socket,
            name: roomName,
            document: ydoc,
            onStateless: ({ payload }) => {
                let message: { type?: string; requestId?: string; ok?: boolean; message?: string }
                try {
                    message = JSON.parse(payload)
                } catch {
                    return
                }
                if (message.type === 'doco:quota-error') {
                    setLimitMessage(message.message || '文档已达到容量上限')
                    return
                }
                if (message.type !== 'doco:save-result' || message.requestId !== saveRequestRef.current) return
                saveRequestRef.current = null
                clearTimeout(saveStatusTimerRef.current)
                setSaveStatus(message.ok ? 'saved' : 'error')
                saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
            },
        })
        // 显式传入 websocketProvider 时不会自动 attach，必须手动调用
        provider.attach()
        collaborationProviderRef.current = provider

        // IndexedDB 主存储先加载，再连服务器；初始状态互补由 SyncStep1/2 协议双向完成
        idb.once('synced', () => {
            if (disposed) return
            // 本地快照恢复完成后才挂载 EditorContent，避免用户在恢复过程中编辑临时状态。
            setReadyPersistenceKey(persistenceKey)
            if (!socket) return
            connectTimer = setTimeout(() => {
                if (!disposed) socket?.connect()
            }, 0)
        })

        return () => {
            disposed = true
            if (connectTimer) clearTimeout(connectTimer)
            if (collaborationProviderRef.current === provider) collaborationProviderRef.current = null
            provider?.destroy()
            socket?.destroy()
            idb.destroy()
        }
    }, [ydoc, persistenceKey, websocketUrl, roomName])

    // Cmd/Ctrl+S：拦截浏览器“保存网页”，通过当前协同连接要求后端立即持久化。
    useEffect(() => {
        const handleSaveShortcut = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 's') return
            event.preventDefault()

            const provider = collaborationProviderRef.current
            clearTimeout(saveStatusTimerRef.current)
            if (!provider?.synced) {
                setSaveStatus('error')
                saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
                return
            }

            const requestId = crypto.randomUUID()
            saveRequestRef.current = requestId
            setSaveStatus('saving')
            provider.sendStateless(JSON.stringify({ type: 'doco:save', requestId }))
            saveStatusTimerRef.current = setTimeout(() => {
                if (saveRequestRef.current !== requestId) return
                saveRequestRef.current = null
                setSaveStatus('error')
                saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
            }, 5000)
        }

        window.addEventListener('keydown', handleSaveShortcut)
        return () => {
            window.removeEventListener('keydown', handleSaveShortcut)
            clearTimeout(saveStatusTimerRef.current)
        }
    }, [])

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
    const collapseChangeRef = useRef<(ids: string[]) => void>()
    collapseChangeRef.current = (ids: string[]) => {
        clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = setTimeout(() => {
            onSettingsChange?.(docId, { collapsedBlocks: ids })
        }, 800)
    }
    const handleCollapseChange = useCallback((ids: string[]) => {
        collapseChangeRef.current?.(ids)
    }, [])

    const handleDocumentLimit = useCallback((limit: number) => {
        setLimitMessage(`正文最多允许 ${limit.toLocaleString()} 个非空白可见字符`)
    }, [])

    const extensions = useMemo(() => {
        const exts: any[] = [
            (StarterKit as any).configure({
                document: false,
                codeBlock: false,
                undoRedo: !isCollaborative,
                link: {
                    openOnClick: false,
                    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
                },
            }),
        ]

        // Collaboration 必须在自定义节点之前注册
        if (isCollaborative) {
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
            DocoDocument,
            BlockIdExtension,
            DocumentLimitExtension.configure({
                limit: DOCUMENT_CHARACTER_LIMIT,
                onLimit: handleDocumentLimit,
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
            SpreadsheetBlock,
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
    }, [ydoc, isCollaborative, placeholderText, extraExtensions, handleCollapseChange, handleDocumentLimit])

    const editor = useEditor({
        extensions,
        // IndexedDB 恢复前不挂载 EditorContent；这里同时显式使用真正的空 doc，
        // 避免 Collaboration 初始化时把默认段落写入尚未恢复的 YDoc。
        content: { type: 'doc', content: [] },
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
    }, [extensions])

    // 从后端恢复折叠状态（需等 Yjs 文档同步完成后再执行）
    useEffect(() => {
        if (!editor || !initialMeta?.collapsedBlocks?.length) return
        const tryRestore = () => {
            const raw = initialMeta.collapsedBlocks || []
            const ids = raw.map((value) => {
                if (value.startsWith('block_')) return value
                const position = Number(value)
                return Number.isFinite(position) ? editor.state.doc.nodeAt(position)?.attrs?.id as string | undefined : undefined
            }).filter((value): value is string => Boolean(value))
            ;(editor.commands as any).setCollapsed(ids)
            if (ids.length && ids.some((id, index) => id !== raw[index])) {
                patchDocSettings({ collapsedBlocks: ids })
            }
            return true
        }

        // 文档可能已经加载好了（IndexedDB 离线缓存）
        if (tryRestore()) return

        // 否则等 Yjs 同步触发 editor update
        const onUpdate = () => {
            if (tryRestore()) editor.off('update', onUpdate)
        }
        editor.on('update', onUpdate)
        return () => { editor.off('update', onUpdate) }
    }, [editor, initialMeta, patchDocSettings])

    // 字数统计
    useEffect(() => {
        if (!editor) return
        const update = () => {
            const nextCount = countVisibleCharacters(editor.state.doc)
            setWordCount(nextCount)
            if (nextCount < DOCUMENT_CHARACTER_LIMIT) setLimitMessage('')
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

    const getMarkdown = useCallback(() => {
        if (!editor) return ''
        return (editor.storage as any).markdown.getMarkdown()
    }, [editor])

    const exportMarkdown = useCallback(() => {
        if (!editor) return
        const md = (editor.storage as any).markdown.getMarkdown()
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${title || 'document'}.md`
        link.click()
    }, [editor, title])

    const exportPDF = useCallback(() => {
        const element = document.querySelector('.tiptap-editor-container')
        if (element) {
            html2pdf().from(element as HTMLElement).save(`${title || 'document'}.pdf`)
        }
    }, [title])

    const exportWord = useCallback(async () => {
        if (!editor) return
        const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body>${editor.getHTML()}</body></html>`
        const blob = new Blob([html], { type: 'application/msword;charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${title || 'document'}.doc`
        link.click()
    }, [editor, title])

    useImperativeHandle(ref, () => ({
        importMarkdown: (markdown: string) => editor?.commands.setContent(markdown),
        importHTML: (html: string) => editor?.commands.setContent(html),
        exportMarkdown,
        exportPDF,
        exportWord,
        getEditor: () => editor,
    }), [editor, exportMarkdown, exportPDF, exportWord])

    return (
        <div className={`doco-editor-root doco-document-canvas w-full max-w-4xl mx-auto min-h-[80vh] border p-4 shadow-sm sm:mt-6 sm:rounded-lg sm:p-10 sm:px-14 relative group transition-colors ${className || ''}`}
            style={{ backgroundColor: bgColor.toLowerCase() === '#ffffff' ? 'var(--surface-canvas)' : bgColor, ...style }}
        >
            {/* 左侧目录导航 */}
            {editor && isPersistenceReady && <TableOfContents editor={editor} headingNumbered={headingNumbered} />}
            {/* 文档级操作 */}
            <div className="document-title-actions absolute right-3 top-3 z-10 transition-opacity sm:right-4 sm:top-4 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <button
                    type="button"
                    onClick={onImportRequest}
                    title="导入文档"
                    aria-label="导入文档"
                >
                    <Upload size={16} />
                </button>
                <div ref={exportMenuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setExportOpen(value => !value)}
                        className="document-title-action-menu"
                        title="导出文档"
                        aria-label="导出文档"
                        aria-haspopup="menu"
                        aria-expanded={exportOpen}
                    >
                        <Download size={16} />
                        <ChevronDown size={12} />
                    </button>
                    {exportOpen && (
                        <div className="doco-menu absolute right-0 top-full z-50 mt-2 min-w-32 rounded-lg p-1 shadow-lg" role="menu">
                            <button type="button" role="menuitem" onClick={() => { exportMarkdown(); setExportOpen(false) }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100">Markdown</button>
                            <button type="button" role="menuitem" onClick={() => { void exportWord(); setExportOpen(false) }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100">Word</button>
                            <button type="button" role="menuitem" onClick={() => { exportPDF(); setExportOpen(false) }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100">PDF</button>
                            <button type="button" role="menuitem" onClick={() => { setWechatExportOpen(true); setExportOpen(false) }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100">公众号</button>
                        </div>
                    )}
                </div>
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
                onKeyDown={e => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        if (isPersistenceReady) editor?.commands.focus('start')
                    }
                }}
                placeholder="无标题"
                rows={1}
                className="doco-document-title mb-4 w-full resize-none overflow-hidden border-none bg-transparent pr-32 text-2xl font-bold leading-snug outline-none sm:text-3xl"
            />

            <div className="tiptap-editor-container relative">
                {editor && isPersistenceReady && <FloatingToolbar editor={editor} />}
                {editor && isPersistenceReady && <BlockHandle editor={editor} />}
                {editor && isPersistenceReady && <InlineMarkToolbar editor={editor} />}
                {editor && isPersistenceReady && <TableToolbar editor={editor} />}
                {editor && isPersistenceReady && linkPopover && (
                    <LinkPopover
                        editor={editor}
                        pos={linkPopover}
                        initialUrl={linkPopover.href}
                        isEdit={editor.isActive('link')}
                        onClose={() => setLinkPopover(null)}
                    />
                )}
                {isPersistenceReady ? (
                    <EditorContent editor={editor} />
                ) : (
                    <div
                        className="min-h-[500px] animate-pulse rounded-lg bg-gray-50/60"
                        role="status"
                        aria-label="正在恢复本地文档"
                    />
                )}
            </div>

            {/* Markdown 粘贴提示弹窗 */}
            <PasteMarkdownDialog
                visible={pasteDialog.state.visible}
                text={pasteDialog.state.text}
                onChoice={pasteDialog.handleChoice}
            />

            {/* 公众号导出弹窗 */}
            <WeChatExportDialog
                open={wechatExportOpen}
                title={title}
                getMarkdown={getMarkdown}
                onClose={() => setWechatExportOpen(false)}
            />

            {/* 底部状态栏 */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex items-center text-xs text-gray-400">
                <span className={wordCount >= DOCUMENT_CHARACTER_LIMIT * 0.8 ? 'text-amber-600' : ''}>
                    {wordCount.toLocaleString()} / {DOCUMENT_CHARACTER_LIMIT.toLocaleString()} 字
                </span>
                {limitMessage && <span className="ml-3 text-red-500" role="alert">{limitMessage}</span>}
                {saveStatus !== 'idle' && (
                    <span className={`ml-auto ${saveStatus === 'error' ? 'text-red-500' : ''}`} role="status">
                        {saveStatus === 'saving' && '正在保存…'}
                        {saveStatus === 'saved' && '已保存到后端'}
                        {saveStatus === 'error' && '保存失败，请检查连接'}
                    </span>
                )}
            </div>
        </div>
    )
})
