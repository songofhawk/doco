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
    Highlighter
} from 'lucide-react'

export const FloatingToolbar = ({ editor }: { editor: Editor }) => {
    if (!editor) return null

    const items = [
        {
            icon: Bold,
            action: () => editor.chain().focus().toggleBold().run(),
            isActive: editor.isActive('bold'),
            tooltip: '加粗 (Cmd+B)',
        },
        {
            icon: Italic,
            action: () => editor.chain().focus().toggleItalic().run(),
            isActive: editor.isActive('italic'),
            tooltip: '斜体 (Cmd+I)',
        },
        {
            icon: Underline,
            action: () => editor.chain().focus().toggleUnderline().run(),
            isActive: editor.isActive('underline'),
            tooltip: '下划线 (Cmd+U)',
        },
        {
            icon: Strikethrough,
            action: () => editor.chain().focus().toggleStrike().run(),
            isActive: editor.isActive('strike'),
            tooltip: '删除线 (Cmd+Shift+X)',
        },
        {
            icon: Code,
            action: () => editor.chain().focus().toggleCode().run(),
            isActive: editor.isActive('code'),
            tooltip: '行内代码 (Cmd+E)',
        },
        {
            icon: Highlighter,
            action: () => (editor.chain().focus() as any).toggleHighlight().run(),
            isActive: editor.isActive('highlight'),
            tooltip: '高亮',
        },
        {
            icon: LinkIcon,
            action: () => {
                const url = window.prompt('URL')
                if (url) {
                    editor.chain().focus().setLink({ href: url }).run()
                } else if (url === '') {
                    editor.chain().focus().unsetLink().run()
                }
            },
            isActive: editor.isActive('link'),
            tooltip: '链接 (Cmd+K)',
        },
        {
            icon: AlignLeft,
            action: () => (editor.chain().focus() as any).setTextAlign('left').run(),
            isActive: editor.isActive({ textAlign: 'left' }),
            tooltip: '左对齐',
        },
        {
            icon: AlignCenter,
            action: () => (editor.chain().focus() as any).setTextAlign('center').run(),
            isActive: editor.isActive({ textAlign: 'center' }),
            tooltip: '居中对齐',
        },
        {
            icon: AlignRight,
            action: () => (editor.chain().focus() as any).setTextAlign('right').run(),
            isActive: editor.isActive({ textAlign: 'right' }),
            tooltip: '右对齐',
        }
    ]

    return (
        <TiptapBubbleMenu editor={editor} className="flex overflow-hidden border border-gray-200 rounded-lg shadow-xl bg-white divide-x divide-gray-100 z-50">
            <div className="flex px-1 items-center">
                {items.map((item, index) => (
                    <button
                        key={index}
                        onClick={item.action}
                        className={`p-2 m-0.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors ${item.isActive ? 'bg-gray-100/80 text-blue-600' : ''
                            }`}
                        title={item.tooltip}
                    >
                        <item.icon className="w-4 h-4" />
                    </button>
                ))}
            </div>
        </TiptapBubbleMenu>
    )
}
