import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { FloatingToolbar } from './components/BubbleMenu'
import { BlockHandle } from './components/BlockHandle'
import { InlineMarkToolbar } from './components/InlineMarkToolbar'
import { LinkPopover } from './components/LinkPopover'
import { TableToolbar } from './components/TableToolbar'
import { detectMarkdown, PasteMarkdownDialog, usePasteMarkdownDialog } from './components/PasteMarkdownDialog'
import { countVisibleCharacters } from './documentLimits'
import { createDocoEditorExtensions } from './editorExtensions'
import { embedEditorImage, gifFileFromSource, pastedGifSource } from './imageUtils'
import type {
    DocoTextEditorChange,
    DocoTextEditorFormat,
    DocoTextEditorOutputFormat,
    DocoTextEditorProps,
    DocoTextEditorRef,
    DocoTextEditorValue,
} from './types'

const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
const DEFAULT_RESOLVE_IMAGE_SRC = (src: string) => src

type MarkdownStorage = {
    getMarkdown?: () => string
    parser?: { parse: (markdown: string) => JSONContent }
}

function markdownStorage(editor: ReturnType<typeof useEditor>) {
    return (editor?.storage as unknown as { markdown?: MarkdownStorage })?.markdown
}

function parseContent(editor: NonNullable<ReturnType<typeof useEditor>>, value: DocoTextEditorValue, format: DocoTextEditorFormat) {
    if (format === 'tiptap-json') {
        if (typeof value === 'string') return JSON.parse(value) as JSONContent
        return value
    }
    if (typeof value !== 'string') return value
    if (format === 'markdown') return markdownStorage(editor)?.parser?.parse(value) || value
    return value
}

function contentFor(
    editor: NonNullable<ReturnType<typeof useEditor>>,
    format: DocoTextEditorOutputFormat,
): JSONContent | string {
    if (format === 'tiptap-json') return editor.getJSON()
    if (format === 'html') return editor.getHTML()
    if (format === 'markdown') return markdownStorage(editor)?.getMarkdown?.() || editor.getText()
    return editor.getText()
}

function comparableValue(value: DocoTextEditorValue, format: DocoTextEditorFormat) {
    if (format === 'tiptap-json') {
        if (typeof value !== 'string') return JSON.stringify(value)
        try {
            return JSON.stringify(JSON.parse(value))
        } catch {
            return value
        }
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
}

function comparableEditorContent(editor: NonNullable<ReturnType<typeof useEditor>>, format: DocoTextEditorFormat) {
    const content = contentFor(editor, format)
    return typeof content === 'string' ? content : JSON.stringify(content)
}

export const DocoTextEditor = forwardRef<DocoTextEditorRef, DocoTextEditorProps>(({
    value,
    defaultValue,
    format = 'tiptap-json',
    editable = true,
    placeholder = '输入 / 唤起菜单，或直接开始写作...',
    onChange,
    onReady,
    onBlur,
    onError,
    uploadImage: configuredUploadImage,
    resolveImageSrc: configuredResolveImageSrc,
    renderPlantUML,
    extraExtensions,
    characterLimit = false,
    showStatusBar = true,
    showFloatingToolbar = true,
    showBlockHandle = true,
    showInlineToolbar = true,
    showTableToolbar = true,
    className,
    editorClassName,
    style,
}, ref) => {
    const rootRef = useRef<HTMLDivElement>(null)
    const initializedRef = useRef(false)
    const readyForUpdatesRef = useRef(false)
    const onChangeRef = useRef(onChange)
    const onReadyRef = useRef(onReady)
    const onBlurRef = useRef(onBlur)
    const onErrorRef = useRef(onError)
    const uploadImageRef = useRef(configuredUploadImage === undefined ? embedEditorImage : configuredUploadImage)
    const resolveImageSrcRef = useRef(configuredResolveImageSrc)
    const [characterCount, setCharacterCount] = useState(0)
    const [limitMessage, setLimitMessage] = useState('')
    const [linkPopover, setLinkPopover] = useState<{ top: number; left: number; href: string } | null>(null)
    const pasteDialog = usePasteMarkdownDialog()

    onChangeRef.current = onChange
    onReadyRef.current = onReady
    onBlurRef.current = onBlur
    onErrorRef.current = onError
    uploadImageRef.current = configuredUploadImage === undefined ? embedEditorImage : configuredUploadImage
    resolveImageSrcRef.current = configuredResolveImageSrc

    const imageUploadEnabled = configuredUploadImage !== null
    const uploadImage = useMemo(() => imageUploadEnabled
        ? (file: File) => uploadImageRef.current!(file)
        : null, [imageUploadEnabled])
    const resolveImageSrc = useCallback((src: string, attachmentId?: string | null) => (
        resolveImageSrcRef.current || DEFAULT_RESOLVE_IMAGE_SRC
    )(src, attachmentId), [])

    const reportError = useCallback((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error || '编辑器操作失败'))
        onErrorRef.current?.(normalized)
        if (!onErrorRef.current) setLimitMessage(normalized.message)
    }, [])

    const handleLimit = useCallback((limit: number) => {
        setLimitMessage(`正文最多允许 ${limit.toLocaleString()} 个非空白可见字符`)
    }, [])

    const extensions = useMemo(() => {
        return createDocoEditorExtensions({
            placeholder,
            uploadImage,
            resolveImageSrc,
            extraExtensions,
            characterLimit,
            onLimit: handleLimit,
            renderPlantUML,
        })
    }, [characterLimit, extraExtensions, handleLimit, placeholder, renderPlantUML, resolveImageSrc, uploadImage])

    const editor = useEditor({
        extensions,
        content: EMPTY_DOCUMENT,
        editable,
        editorProps: {
            attributes: {
                class: `doco-text-editor-content focus:outline-none min-h-[320px] text-gray-800 leading-relaxed prose prose-blue sm:prose-base list-none ${editorClassName || ''}`,
            },
            handleDrop(view, event, _slice, moved) {
                if (moved || !uploadImage || !event.dataTransfer?.files.length) return false
                const file = event.dataTransfer.files[0]
                if (!file.type.startsWith('image/')) return false
                event.preventDefault()
                const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })
                if (!dropPos) return true
                void uploadImage(file).then((image) => {
                    editor?.chain().focus().insertContentAt(dropPos.pos, {
                        type: 'image',
                        attrs: { src: image.src, attachmentId: image.id || null },
                    }).run()
                }).catch(reportError)
                return true
            },
            handlePaste(view, event) {
                const items = event.clipboardData?.items
                if (!items) return false
                const insertPos = view.state.selection.from
                const gifSource = pastedGifSource(event.clipboardData?.getData('text/html') || '')

                if (gifSource && uploadImage) {
                    event.preventDefault()
                    void gifFileFromSource(gifSource)
                        .then(uploadImage)
                        .then((image) => editor?.chain().focus().insertContentAt(insertPos, {
                            type: 'image', attrs: { src: image.src, attachmentId: image.id || null },
                        }).run())
                        .catch((error) => {
                            if (/^https?:\/\//i.test(gifSource)) {
                                editor?.chain().focus().insertContentAt(insertPos, {
                                    type: 'image', attrs: { src: gifSource },
                                }).run()
                            } else {
                                reportError(error)
                            }
                        })
                    return true
                }

                if (uploadImage) {
                    for (const item of items) {
                        if (!item.type.startsWith('image/')) continue
                        const file = item.getAsFile()
                        if (!file) return false
                        event.preventDefault()
                        void uploadImage(file).then((image) => {
                            editor?.chain().focus().insertContentAt(insertPos, {
                                type: 'image', attrs: { src: image.src, attachmentId: image.id || null },
                            }).run()
                        }).catch(reportError)
                        return true
                    }
                }

                const text = event.clipboardData?.getData('text/plain') || ''
                if (!text || !detectMarkdown(text)) return false
                event.preventDefault()
                pasteDialog.prompt(text).then((asRichText) => {
                    if (!editor) return
                    if (asRichText) {
                        editor.commands.insertContent(markdownStorage(editor)?.parser?.parse(text) || text)
                    } else {
                        editor.commands.insertContent({
                            type: 'codeBlock',
                            attrs: { language: 'markdown' },
                            content: [{ type: 'text', text }],
                        })
                    }
                }).catch(reportError)
                return true
            },
        },
        onUpdate: ({ editor: currentEditor, transaction }) => {
            const nextCharacterCount = countVisibleCharacters(currentEditor.state.doc)
            setCharacterCount(nextCharacterCount)
            if (characterLimit === false || nextCharacterCount < characterLimit) setLimitMessage('')
            if (!readyForUpdatesRef.current) return
            const change: DocoTextEditorChange = {
                steps: transaction.steps.map(step => step.toJSON() as Record<string, unknown>),
            }
            onChangeRef.current?.(change)
        },
        onBlur: () => {
            if (readyForUpdatesRef.current) onBlurRef.current?.()
        },
    }, [extensions])

    useEffect(() => {
        editor?.setEditable(editable)
    }, [editable, editor])

    useEffect(() => {
        if (!editor) return
        onReadyRef.current?.(editor)
    }, [editor])

    useEffect(() => {
        if (!editor) return
        const nextValue = value !== undefined ? value : initializedRef.current ? undefined : defaultValue
        initializedRef.current = true
        if (nextValue === undefined) {
            setCharacterCount(countVisibleCharacters(editor.state.doc))
            readyForUpdatesRef.current = true
            return
        }

        try {
            if (comparableEditorContent(editor, format) !== comparableValue(nextValue, format)) {
                editor.commands.setContent(parseContent(editor, nextValue, format), { emitUpdate: false })
            }
            setCharacterCount(countVisibleCharacters(editor.state.doc))
            readyForUpdatesRef.current = true
        } catch (error) {
            reportError(error)
            readyForUpdatesRef.current = true
        }
    }, [defaultValue, editor, format, reportError, value])

    useEffect(() => {
        if (!editor) return
        const handler = (event: Event) => {
            if (!editor.isFocused) return
            const { top, left, href } = (event as CustomEvent).detail
            setLinkPopover({ top, left, href })
        }
        window.addEventListener('editor-link-edit', handler)
        return () => window.removeEventListener('editor-link-edit', handler)
    }, [editor])

    useImperativeHandle(ref, () => {
        const getContent = ((outputFormat: DocoTextEditorOutputFormat) => {
            if (!editor) return outputFormat === 'tiptap-json' ? null : ''
            return contentFor(editor, outputFormat)
        }) as DocoTextEditorRef['getContent']

        return {
        focus: (position = 'end') => { editor?.commands.focus(position) },
        clear: () => { editor?.commands.clearContent() },
        setContent: (nextValue, nextFormat = format) => {
            if (!editor) return
            try {
                editor.commands.setContent(parseContent(editor, nextValue, nextFormat))
            } catch (error) {
                reportError(error)
            }
        },
        getContent,
        getEditor: () => editor,
        getRootElement: () => rootRef.current,
        }
    }, [editor, format, reportError])

    return (
        <div
            ref={rootRef}
            className={`doco-editor-root doco-text-editor ${className || ''}`}
            style={style}
        >
            <div className="doco-text-editor-surface">
                <div className="tiptap-editor-container relative">
                    {editor && showFloatingToolbar && <FloatingToolbar editor={editor} />}
                    {editor && showBlockHandle && <BlockHandle editor={editor} />}
                    {editor && showInlineToolbar && <InlineMarkToolbar editor={editor} />}
                    {editor && showTableToolbar && <TableToolbar editor={editor} />}
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

                <PasteMarkdownDialog
                    visible={pasteDialog.state.visible}
                    text={pasteDialog.state.text}
                    onChoice={pasteDialog.handleChoice}
                />

                {showStatusBar && (
                    <div className="doco-text-editor-status" aria-live="polite">
                        <span>{characterCount.toLocaleString()} 字</span>
                        {characterLimit !== false && <span> / {characterLimit.toLocaleString()}</span>}
                        {limitMessage && <span className="doco-text-editor-error" role="alert">{limitMessage}</span>}
                    </div>
                )}
            </div>
        </div>
    )
})

DocoTextEditor.displayName = 'DocoTextEditor'
