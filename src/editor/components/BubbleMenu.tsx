import { useState, useRef, useMemo, useEffect } from 'react'
import { Editor } from '@tiptap/react'
import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react/menus'
import {
    Bold,
    Italic,
    Underline,
    Strikethrough,
    Code,
    Link as LinkIcon,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Highlighter,
    Trash2
} from 'lucide-react'
import { LinkPopover } from './LinkPopover'

export const FloatingToolbar = ({ editor }: { editor: Editor }) => {
    const [focusIndex, setFocusIndex] = useState(-1)
    const [linkPopover, setLinkPopover] = useState<{ top: number; left: number } | null>(null)
    const [, forceUpdate] = useState({})
    const toolbarRef = useRef<HTMLDivElement>(null)

    // 监听 editor 状态变化，强制重新渲染
    useEffect(() => {
        const handleUpdate = () => forceUpdate({})
        editor.on('selectionUpdate', handleUpdate)
        return () => {
            editor.off('selectionUpdate', handleUpdate)
        }
    }, [editor])

    if (!editor) return null

    const allItems = useMemo(() => [
        {
            icon: Bold,
            action: () => editor.chain().focus().toggleBold().run(),
            isActive: editor.isActive('bold'),
            tooltip: '加粗',
            shortcut: '⌘B',
            showFor: ['text']
        },
        {
            icon: Italic,
            action: () => editor.chain().focus().toggleItalic().run(),
            isActive: editor.isActive('italic'),
            tooltip: '斜体',
            shortcut: '⌘I',
            showFor: ['text']
        },
        {
            icon: Underline,
            action: () => editor.chain().focus().toggleUnderline().run(),
            isActive: editor.isActive('underline'),
            tooltip: '下划线',
            shortcut: '⌘U',
            showFor: ['text']
        },
        {
            icon: Strikethrough,
            action: () => editor.chain().focus().toggleStrike().run(),
            isActive: editor.isActive('strike'),
            tooltip: '删除线',
            shortcut: '⌘⇧X',
            showFor: ['text']
        },
        {
            icon: Code,
            action: () => editor.chain().focus().toggleCode().run(),
            isActive: editor.isActive('code'),
            tooltip: '行内代码',
            shortcut: '⌘E',
            showFor: ['text']
        },
        {
            icon: Highlighter,
            action: () => (editor.chain().focus() as any).toggleHighlight().run(),
            isActive: editor.isActive('highlight'),
            tooltip: '高亮',
            shortcut: '⌘⇧H',
            showFor: ['text']
        },
        {
            icon: LinkIcon,
            action: () => {
                const { from } = editor.state.selection
                const coords = editor.view.coordsAtPos(from)
                setLinkPopover({ top: coords.top - 44, left: coords.left })
            },
            isActive: editor.isActive('link') || !!linkPopover,
            tooltip: '链接',
            shortcut: '⌘K',
            showFor: ['text']
        },
        {
            icon: AlignLeft,
            action: () => (editor.chain().focus() as any).setTextAlign('left').run(),
            isActive: editor.isActive({ textAlign: 'left' }),
            tooltip: '左对齐',
            shortcut: '⌘⇧L',
            showFor: ['text', 'image']
        },
        {
            icon: AlignCenter,
            action: () => (editor.chain().focus() as any).setTextAlign('center').run(),
            isActive: editor.isActive({ textAlign: 'center' }),
            tooltip: '居中对齐',
            shortcut: '⌘⇧E',
            showFor: ['text', 'image']
        },
        {
            icon: AlignRight,
            action: () => (editor.chain().focus() as any).setTextAlign('right').run(),
            isActive: editor.isActive({ textAlign: 'right' }),
            tooltip: '右对齐',
            shortcut: '⌘⇧R',
            showFor: ['text', 'image']
        },
        {
            icon: Trash2,
            action: () => editor.chain().focus().deleteSelection().run(),
            isActive: false,
            tooltip: '删除',
            shortcut: 'Del',
            showFor: ['image']
        }
    ], [editor, linkPopover])

    // 检测选中内容类型
    const isImage = editor.isActive('image')
    const isCodeBlock = editor.isActive('codeBlock')
    const isMermaid = editor.isActive('mermaid')
    const isPlantUML = editor.isActive('plantuml')

    // 根据选中内容类型过滤按钮
    let contentType = 'text'
    if (isImage) contentType = 'image'
    else if (isCodeBlock || isMermaid || isPlantUML) return null

    const items = allItems.filter(item => item.showFor.includes(contentType))

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const count = items.length
        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault()
                setFocusIndex(i => (i + 1) % count)
                break
            case 'ArrowLeft':
                e.preventDefault()
                setFocusIndex(i => (i - 1 + count) % count)
                break
            case 'Enter':
            case ' ':
                e.preventDefault()
                if (focusIndex >= 0) items[focusIndex]?.action()
                break
            case 'Escape':
                e.preventDefault()
                setFocusIndex(-1)
                editor.commands.focus()
                break
        }
    }

    return (
        <>
        {linkPopover && (
            <LinkPopover
                editor={editor}
                pos={linkPopover}
                initialUrl={editor.getAttributes('link').href || ''}
                isEdit={editor.isActive('link')}
                onClose={() => setLinkPopover(null)}
            />
        )}
        <TiptapBubbleMenu
            editor={editor}
            shouldShow={({ editor, state }) => {
                const { from, to } = state.selection
                const hasSelection = from !== to
                const isImage = editor.isActive('image')

                return (hasSelection || isImage)
                    && !editor.isActive('codeBlock')
                    && !editor.isActive('mermaid')
                    && !editor.isActive('plantuml')
            }}
            className="flex overflow-hidden border border-gray-200 rounded-lg shadow-xl bg-white divide-x divide-gray-100 z-50"
        >
            <div
                ref={toolbarRef}
                className="flex px-1 items-center outline-none"
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                onMouseLeave={() => setFocusIndex(-1)}
            >
                {items.map((item, index) => {
                    const needsSeparator = item.tooltip === '删除' && index > 0
                    return (
                        <div key={index} className="flex items-center">
                            {needsSeparator && (
                                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                            )}
                            <button
                                onClick={item.action}
                                onMouseEnter={() => setFocusIndex(index)}
                                className={`relative p-2 m-0.5 rounded-md transition-colors group
                                    ${item.tooltip === '删除' ? 'text-red-500 hover:bg-red-50' : 'text-gray-500 hover:bg-gray-100'}
                                    ${focusIndex === index ? 'bg-gray-100 ring-1 ring-blue-300' : ''}
                                    ${item.isActive ? 'bg-gray-100/80 text-blue-600' : ''}`}
                                title={`${item.tooltip} (${item.shortcut})`}
                            >
                                <item.icon className="w-4 h-4" />
                                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                                    {item.tooltip} <kbd className="ml-0.5 text-gray-300">{item.shortcut}</kbd>
                                </span>
                            </button>
                        </div>
                    )
                })}
            </div>
        </TiptapBubbleMenu>
        </>
    )
}
