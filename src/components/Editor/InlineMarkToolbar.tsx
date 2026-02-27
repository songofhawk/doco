import { useEffect, useState, useRef, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { X, Pencil, Copy, ExternalLink, Code, Highlighter, Link as LinkIcon } from 'lucide-react'

type MarkType = 'code' | 'highlight' | 'link'

interface MarkInfo {
    type: MarkType
    element: HTMLElement
    href?: string
}

export const InlineMarkToolbar = ({ editor }: { editor: Editor }) => {
    const [mark, setMark] = useState<MarkInfo | null>(null)
    const [pos, setPos] = useState({ top: 0, left: 0 })
    const [visible, setVisible] = useState(false)
    const toolbarRef = useRef<HTMLDivElement>(null)
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 记录当前悬停的 mark 元素，用于 mousemove 判断
    const activeEl = useRef<HTMLElement | null>(null)

    const clearHideTimer = useCallback(() => {
        if (hideTimer.current) {
            clearTimeout(hideTimer.current)
            hideTimer.current = null
        }
    }, [])

    const scheduleHide = useCallback(() => {
        clearHideTimer()
        hideTimer.current = setTimeout(() => {
            setVisible(false)
            setMark(null)
            activeEl.current = null
        }, 300)
    }, [clearHideTimer])

    const show = useCallback((info: MarkInfo) => {
        clearHideTimer()
        activeEl.current = info.element
        const rect = info.element.getBoundingClientRect()
        setMark(info)
        setPos({
            top: rect.top - 36,
            left: rect.left + rect.width / 2,
        })
        setVisible(true)
    }, [clearHideTimer])

    useEffect(() => {
        if (!editor?.view) return
        const dom = editor.view.dom

        const findMark = (target: HTMLElement): MarkInfo | null => {
            const code = target.closest('.ProseMirror code:not(pre code)') as HTMLElement
            if (code) return { type: 'code', element: code }

            const m = target.closest('.ProseMirror mark') as HTMLElement
            if (m) return { type: 'highlight', element: m }

            const link = target.closest('.ProseMirror a') as HTMLAnchorElement
            if (link) return { type: 'link', element: link, href: link.getAttribute('href') || '' }

            return null
        }

        const onMove = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target || target.nodeType !== 1) return

            // 鼠标在 toolbar 上，保持显示
            if (toolbarRef.current?.contains(target)) {
                clearHideTimer()
                return
            }

            const info = findMark(target)
            if (info) {
                // 同一个元素不重复计算位置
                if (activeEl.current === info.element && visible) {
                    clearHideTimer()
                    return
                }
                show(info)
            } else if (visible) {
                scheduleHide()
            }
        }

        const onLeave = (e: MouseEvent) => {
            // 鼠标移到 toolbar 上时不隐藏
            const related = e.relatedTarget as Node | null
            if (related && toolbarRef.current?.contains(related)) return
            if (visible) scheduleHide()
        }

        dom.addEventListener('mousemove', onMove)
        dom.addEventListener('mouseleave', onLeave as EventListener)
        return () => {
            dom.removeEventListener('mousemove', onMove)
            dom.removeEventListener('mouseleave', onLeave as EventListener)
        }
    }, [editor, visible, show, scheduleHide, clearHideTimer])

    // 选中当前 mark 覆盖的文本范围
    const selectMark = useCallback(() => {
        if (!mark) return
        const el = mark.element
        const view = editor.view
        const from = view.posAtDOM(el, 0)
        const to = from + (el.textContent?.length || 0)
        editor.commands.setTextSelection({ from, to })
    }, [editor, mark])

    const dismiss = useCallback(() => {
        clearHideTimer()
        setVisible(false)
        setMark(null)
        activeEl.current = null
    }, [clearHideTimer])

    const handleRemoveCode = useCallback(() => {
        selectMark()
        editor.chain().focus().unsetCode().run()
        dismiss()
    }, [editor, selectMark, dismiss])

    const handleRemoveHighlight = useCallback(() => {
        selectMark()
        ;(editor.chain().focus() as any).unsetHighlight().run()
        dismiss()
    }, [editor, selectMark, dismiss])

    const handleRemoveLink = useCallback(() => {
        selectMark()
        editor.chain().focus().unsetLink().run()
        dismiss()
    }, [editor, selectMark, dismiss])

    const handleEditLink = useCallback(() => {
        selectMark()
        const { from } = editor.state.selection
        const coords = editor.view.coordsAtPos(from)
        window.dispatchEvent(new CustomEvent('editor-link-edit', {
            detail: { top: coords.top - 44, left: coords.left, href: mark?.href || '' }
        }))
        dismiss()
    }, [editor, mark, selectMark, dismiss])

    const handleCopyLink = useCallback(() => {
        if (mark?.href) navigator.clipboard.writeText(mark.href)
        dismiss()
    }, [mark, dismiss])

    const handleOpenLink = useCallback(() => {
        if (mark?.href) window.open(mark.href, '_blank')
        dismiss()
    }, [mark, dismiss])

    if (!visible || !mark) return null

    return (
        <div
            ref={toolbarRef}
            className="fixed z-50 flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-lg px-1 py-0.5 text-xs"
            style={{
                top: pos.top,
                left: pos.left,
                transform: 'translateX(-50%)',
            }}
            onMouseEnter={clearHideTimer}
            onMouseLeave={scheduleHide}
        >
            {mark.type === 'code' && (
                <>
                    <span className="px-1.5 py-1 text-gray-400 flex items-center gap-1">
                        <Code className="w-3 h-3" /> 行内代码
                    </span>
                    <div className="w-px h-4 bg-gray-200" />
                    <button
                        onClick={handleRemoveCode}
                        className="flex items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="移除代码样式 (⌘E)"
                    >
                        <X className="w-3 h-3" /> 移除
                    </button>
                </>
            )}

            {mark.type === 'highlight' && (
                <>
                    <span className="px-1.5 py-1 text-gray-400 flex items-center gap-1">
                        <Highlighter className="w-3 h-3" /> 高亮
                    </span>
                    <div className="w-px h-4 bg-gray-200" />
                    <button
                        onClick={handleRemoveHighlight}
                        className="flex items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="移除高亮 (⌘⇧H)"
                    >
                        <X className="w-3 h-3" /> 移除
                    </button>
                </>
            )}

            {mark.type === 'link' && (
                <>
                    <span className="px-1.5 py-1 text-gray-400 flex items-center gap-1 max-w-[160px] truncate">
                        <LinkIcon className="w-3 h-3 shrink-0" />
                        {mark.href}
                    </span>
                    <div className="w-px h-4 bg-gray-200" />
                    <button
                        onClick={handleEditLink}
                        className="flex items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="编辑链接"
                    >
                        <Pencil className="w-3 h-3" />
                    </button>
                    <button
                        onClick={handleCopyLink}
                        className="flex items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="复制链接"
                    >
                        <Copy className="w-3 h-3" />
                    </button>
                    <button
                        onClick={handleOpenLink}
                        className="flex items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="打开链接"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </button>
                    <div className="w-px h-4 bg-gray-200" />
                    <button
                        onClick={handleRemoveLink}
                        className="flex items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="移除链接"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </>
            )}
        </div>
    )
}
