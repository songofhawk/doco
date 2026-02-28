import { useState, useRef, useEffect, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { Link as LinkIcon, Check, X, Trash2 } from 'lucide-react'

interface LinkPopoverProps {
    editor: Editor
    pos: { top: number; left: number } | null
    initialUrl?: string
    onClose: () => void
    /** 是否为编辑已有链接（显示删除按钮） */
    isEdit?: boolean
}

export const LinkPopover = ({ editor, pos, initialUrl = '', onClose, isEdit = false }: LinkPopoverProps) => {
    const [url, setUrl] = useState(initialUrl)
    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setUrl(initialUrl)
        // 延迟聚焦，确保弹层已渲染
        setTimeout(() => inputRef.current?.focus(), 0)
    }, [initialUrl])

    const handleConfirm = useCallback(() => {
        if (!url.trim()) {
            // 空 URL 时移除链接
            editor.chain().focus().unsetLink().run()
        } else {
            const { from, to, empty } = editor.state.selection
            if (empty && !isEdit) {
                // 没有选中文本时，插入链接文本
                editor.chain().focus()
                    .insertContent(`<a href="${url}">${url}</a>`)
                    .run()
            } else {
                editor.chain().focus().setLink({ href: url }).run()
            }
        }
        onClose()
    }, [editor, url, isEdit, onClose])

    const handleRemove = useCallback(() => {
        editor.chain().focus().unsetLink().run()
        onClose()
    }, [editor, onClose])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleConfirm()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            editor.commands.focus()
            onClose()
        }
    }, [handleConfirm, editor, onClose])

    // 点击外部关闭
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [onClose])

    if (!pos) return null

    return (
        <div
            ref={containerRef}
            className="fixed z-50 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-lg px-2 py-1.5"
            style={{
                top: pos.top,
                left: pos.left,
                transform: 'translateX(-50%)',
            }}
        >
            <LinkIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入链接地址..."
                className="w-56 px-1.5 py-0.5 text-sm border-none outline-none bg-transparent text-gray-700 placeholder:text-gray-300"
            />
            <button
                onClick={handleConfirm}
                className="p-1 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                title="确认 (Enter)"
            >
                <Check className="w-3.5 h-3.5" />
            </button>
            {isEdit && (
                <button
                    onClick={handleRemove}
                    className="p-1 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="移除链接"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            )}
            <button
                onClick={() => { editor.commands.focus(); onClose() }}
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                title="取消 (Esc)"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    )
}
