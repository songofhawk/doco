import { useEffect, useState, useRef } from 'react'
import { Editor } from '@tiptap/react'
import * as Popover from '@radix-ui/react-popover'
import { GripVertical, Plus, Trash2, Copy, Scissors, ArrowDownToLine, Indent, AlignLeft } from 'lucide-react'

export const BlockHandle = ({ editor }: { editor: Editor }) => {
    const [handlePos, setHandlePos] = useState({ top: -999, left: -999 })
    const [hoveredNode, setHoveredNode] = useState<HTMLElement | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!editor || !editor.view) return

        const container = containerRef.current?.parentElement
        if (!container) return

        const updateHandlePosition = (e: MouseEvent) => {
            if (isOpen) return

            const isHoveringHandle = containerRef.current?.contains(e.target as Node)
            if (isHoveringHandle) {
                return // 鼠标在菜单上时，保持菜单显示
            }

            const view = editor.view
            let target = e.target as HTMLElement
            // Find the closest Prosemirror block level element
            while (target && target !== view.dom) {
                if (target.classList && (target.classList.contains('ProseMirror') || target.hasAttribute('data-type'))) {
                    // It's the editor itself or a custom node view
                    break
                }
                const style = window.getComputedStyle(target)
                if (style.display === 'block' || style.display === 'list-item' || style.display === 'flex' || target.tagName === 'P' || target.tagName.match(/^H[1-6]$/)) {
                    break
                }
                target = target.parentElement as HTMLElement
            }

            if (target && target !== view.dom && view.dom.contains(target)) {
                const rect = target.getBoundingClientRect()
                const containerRect = container.getBoundingClientRect()

                // 相对于具有 relative 的 tiptap-editor-container 计算坐标偏移
                setHandlePos({
                    top: rect.top - containerRect.top,
                    left: rect.left - containerRect.left - 48 // 往左多平移一段距离避免重叠
                })
                setHoveredNode(target)
            } else {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
            }
        }

        container.addEventListener('mousemove', updateHandlePosition)
        container.addEventListener('mouseleave', () => !isOpen && setHandlePos({ top: -999, left: -999 }))

        return () => {
            container.removeEventListener('mousemove', updateHandlePosition)
            container.removeEventListener('mouseleave', () => !isOpen && setHandlePos({ top: -999, left: -999 }))
        }
    }, [editor, isOpen])

    const getNodePos = () => {
        if (!hoveredNode || !editor.view) return null
        const pos = editor.view.posAtDOM(hoveredNode, 0)
        return pos
    }

    const handleDelete = () => {
        const pos = getNodePos()
        if (pos !== null) {
            editor.chain().setNodeSelection(pos).deleteSelection().run()
            setIsOpen(false)
        }
    }

    const handleCopy = () => {
        const pos = getNodePos()
        if (pos !== null) {
            editor.commands.setNodeSelection(pos)
            document.execCommand('copy')
            setIsOpen(false)
        }
    }

    const handleCut = () => {
        const pos = getNodePos()
        if (pos !== null) {
            editor.commands.setNodeSelection(pos)
            document.execCommand('cut')
            setIsOpen(false)
        }
    }

    const handleAddBelow = () => {
        const pos = getNodePos()
        if (pos !== null) {
            const node = editor.view.state.doc.nodeAt(pos)
            editor.chain()
                .setNodeSelection(pos)
                .insertContentAt(pos + (node?.nodeSize || 0), { type: 'paragraph' })
                .focus(pos + (node?.nodeSize || 0) + 1)
                .run()
            setIsOpen(false)
        }
    }

    if (!editor) return null

    return (
        <div
            ref={containerRef}
            className="absolute z-40 transition-opacity duration-200 flex items-center gap-1"
            style={{
                top: handlePos.top,
                left: handlePos.left,
                opacity: handlePos.top === -999 ? 0 : 1,
                pointerEvents: handlePos.top === -999 ? 'none' : 'auto'
            }}
        >
            <button
                className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded cursor-pointer"
                onClick={handleAddBelow}
                title="点击添加区块"
            >
                <Plus className="w-4 h-4" />
            </button>

            <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
                <Popover.Trigger asChild>
                    <button className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded cursor-grab active:cursor-grabbing outline-none">
                        <GripVertical className="w-4 h-4" />
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        className="w-48 bg-white rounded-lg shadow-xl border border-gray-100 p-1 flex flex-col z-50 origin-top-left outline-none text-sm"
                        sideOffset={5}
                        align="start"
                    >
                        <button className="flex items-center px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left" onClick={() => setIsOpen(false)}>
                            <Indent className="w-4 h-4 mr-3 text-gray-400" />
                            缩进和对齐
                        </button>
                        <div className="h-px bg-gray-100 my-1"></div>
                        <button className="flex items-center px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left" onClick={handleCut}>
                            <Scissors className="w-4 h-4 mr-3 text-gray-400" />
                            剪切
                        </button>
                        <button className="flex items-center px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left" onClick={handleCopy}>
                            <Copy className="w-4 h-4 mr-3 text-gray-400" />
                            复制
                        </button>
                        <button className="flex items-center px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors w-full text-left" onClick={() => { setIsOpen(false); alert('翻译功能需接入后端 API') }}>
                            <AlignLeft className="w-4 h-4 mr-3 text-blue-400" />
                            翻译...
                        </button>
                        <button className="flex items-center px-3 py-2 text-red-600 hover:bg-red-50 rounded-md transition-colors w-full text-left" onClick={handleDelete}>
                            <Trash2 className="w-4 h-4 mr-3 text-red-400" />
                            删除
                        </button>
                        <div className="h-px bg-gray-100 my-1"></div>
                        <button className="flex items-center px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left" onClick={handleAddBelow}>
                            <ArrowDownToLine className="w-4 h-4 mr-3 text-gray-400" />
                            在下方添加
                        </button>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    )
}
