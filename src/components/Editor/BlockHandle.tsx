import { useEffect, useState, useRef } from 'react'
import { Editor } from '@tiptap/react'
import * as Popover from '@radix-ui/react-popover'
import {
    GripVertical, Plus, Trash2, Copy, Scissors, ArrowDownToLine,
    ArrowUpToLine, CopyPlus, Type, Heading1, Heading2, Heading3,
    List, ListOrdered, ListChecks, Quote, Code, ChevronRight,
    FileText, Pilcrow
} from 'lucide-react'

import type { LucideIcon } from 'lucide-react'

const MenuItem = ({ icon: Icon, label, shortcut, onClick }: { icon: LucideIcon; label: string; shortcut?: string; onClick: () => void }) => (
    <button className="flex items-center px-3 py-1.5 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left" onClick={onClick}>
        <Icon className="w-4 h-4 mr-3 text-gray-400" />
        {label}
        {shortcut && <span className="ml-auto text-xs text-gray-300">{shortcut}</span>}
    </button>
)

const ConvertItem = ({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) => (
    <button className="flex items-center px-3 py-1.5 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left" onClick={onClick}>
        <Icon className="w-4 h-4 mr-3 text-gray-400" />
        {label}
    </button>
)

export const BlockHandle = ({ editor }: { editor: Editor }) => {
    const [handlePos, setHandlePos] = useState({ top: -999, left: -999 })
    const [hoveredNode, setHoveredNode] = useState<HTMLElement | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [showConvertMenu, setShowConvertMenu] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const scheduleHide = () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => {
            if (!isOpen) {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
            }
        }, 150)
    }

    const cancelHide = () => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current)
            hideTimerRef.current = null
        }
    }

    useEffect(() => {
        if (!editor || !editor.view) return

        const container = containerRef.current?.parentElement
        if (!container) return

        const updateHandlePosition = (e: MouseEvent) => {
            if (isOpen) return

            if (containerRef.current?.contains(e.target as Node)) return

            const view = editor.view

            // 用 posAtCoords 从鼠标坐标精确定位到 ProseMirror 文档位置
            const posInfo = view.posAtCoords({ left: e.clientX, top: e.clientY })
            if (!posInfo) {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
                return
            }

            // 从文档位置 resolve 到顶层块节点（depth=1）
            const $pos = view.state.doc.resolve(posInfo.pos)
            const depth = Math.max(1, $pos.depth)
            const topNodePos = $pos.before(depth)
            const topNode = view.state.doc.nodeAt(topNodePos)
            if (!topNode) {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
                return
            }

            // 从文档位置反查 DOM 节点
            const domNode = view.nodeDOM(topNodePos) as HTMLElement | null
            if (!domNode || !view.dom.contains(domNode)) {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
                return
            }

            const target = domNode
            const rect = target.getBoundingClientRect()
            const editorRect = view.dom.getBoundingClientRect()

            // 找到 absolute 定位的实际基准元素（最近的 position:relative 祖先）
            const handleEl = containerRef.current
            const offsetParent = handleEl?.offsetParent as HTMLElement | null
            const baseRect = offsetParent
                ? offsetParent.getBoundingClientRect()
                : container.getBoundingClientRect()

            const computedStyle = window.getComputedStyle(target)
            const lineHeightStr = computedStyle.lineHeight
            const fontSize = parseFloat(computedStyle.fontSize) || 16
            const lineHeight = parseFloat(lineHeightStr) || fontSize * 1.2
            const paddingTop = parseFloat(computedStyle.paddingTop) || 0
            const firstLineCenter = rect.top + paddingTop + Math.min(lineHeight, rect.height) / 2

            setHandlePos({
                top: firstLineCenter - baseRect.top - 12,
                left: editorRect.left - baseRect.left - 40
            })
            setHoveredNode(target)
            cancelHide()
        }

        const onLeave = () => { if (!isOpen) scheduleHide() }

        container.addEventListener('mousemove', updateHandlePosition)
        container.addEventListener('mouseleave', onLeave)

        return () => {
            container.removeEventListener('mousemove', updateHandlePosition)
            container.removeEventListener('mouseleave', onLeave)
        }
    }, [editor, isOpen])

    // posAtDOM 返回的是块内部文本位置，需要 resolve 后回溯到顶层块节点
    const getNodePos = (): number | null => {
        if (!hoveredNode || !editor.view) return null
        const pos = editor.view.posAtDOM(hoveredNode, 0)
        const $pos = editor.state.doc.resolve(pos)
        // 回溯到 depth=1 的顶层块节点（doc 的直接子节点）
        const depth = Math.max(1, $pos.depth)
        return $pos.before(depth)
    }

    const closeMenu = () => { setIsOpen(false); setShowConvertMenu(false) }

    const handleDelete = () => {
        const pos = getNodePos()
        if (pos === null) return
        const node = editor.state.doc.nodeAt(pos)
        if (!node) return
        const { tr } = editor.state
        tr.delete(pos, pos + node.nodeSize)
        editor.view.dispatch(tr)
        closeMenu()
    }

    const handleCopy = () => {
        const pos = getNodePos()
        if (pos !== null) {
            editor.commands.setNodeSelection(pos)
            document.execCommand('copy')
            closeMenu()
        }
    }

    const handleCut = () => {
        const pos = getNodePos()
        if (pos !== null) {
            editor.commands.setNodeSelection(pos)
            document.execCommand('cut')
            closeMenu()
        }
    }

    const handleCopyAsText = () => {
        if (!hoveredNode) return
        const text = hoveredNode.innerText || ''
        navigator.clipboard.writeText(text)
        closeMenu()
    }

    const handleCopyAsMarkdown = () => {
        const pos = getNodePos()
        if (pos === null) return
        const node = editor.state.doc.nodeAt(pos)
        if (!node) return
        // 利用 tiptap-markdown 的 storage 序列化
        const md = (editor.storage as any).markdown?.getMarkdown?.()
        if (md) {
            // 简单取当前块的文本内容作为 markdown 近似
            const lines = md.split('\n')
            const text = hoveredNode?.innerText || ''
            // 找到包含该文本的行
            const matched = lines.filter((l: string) => text && l.includes(text.substring(0, 20)))
            navigator.clipboard.writeText(matched.length > 0 ? matched.join('\n') : text)
        }
        closeMenu()
    }

    const handleDuplicate = () => {
        const pos = getNodePos()
        if (pos === null) return
        const node = editor.state.doc.nodeAt(pos)
        if (!node) return
        const { tr } = editor.state
        const insertPos = pos + node.nodeSize
        tr.insert(insertPos, node.copy(node.content))
        editor.view.dispatch(tr)
        closeMenu()
    }

    const handleMoveUp = () => {
        const pos = getNodePos()
        if (pos === null || pos === 0) return
        const node = editor.state.doc.nodeAt(pos)
        if (!node) return
        // 找前一个兄弟：pos 前面紧邻的节点
        const $pos = editor.state.doc.resolve(pos)
        const index = $pos.index(0) // doc 直接子节点的 index
        if (index === 0) return
        const prevNode = editor.state.doc.child(index - 1)
        const prevPos = pos - prevNode.nodeSize
        // 用 replaceWith 把 [prevNode, node] 整体替换为 [node, prevNode]
        const { tr } = editor.state
        tr.replaceWith(prevPos, pos + node.nodeSize,
            [node.copy(node.content), prevNode.copy(prevNode.content)])
        editor.view.dispatch(tr)
        closeMenu()
    }

    const handleMoveDown = () => {
        const pos = getNodePos()
        if (pos === null) return
        const node = editor.state.doc.nodeAt(pos)
        if (!node) return
        const $pos = editor.state.doc.resolve(pos)
        const index = $pos.index(0)
        if (index >= editor.state.doc.childCount - 1) return
        const nextNode = editor.state.doc.child(index + 1)
        const endPos = pos + node.nodeSize + nextNode.nodeSize
        // 用 replaceWith 把 [node, nextNode] 整体替换为 [nextNode, node]
        const { tr } = editor.state
        tr.replaceWith(pos, endPos,
            [nextNode.copy(nextNode.content), node.copy(node.content)])
        editor.view.dispatch(tr)
        closeMenu()
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
            closeMenu()
        }
    }

    const handleConvert = (type: string, level?: number) => {
        const pos = getNodePos()
        if (pos === null) return
        const node = editor.state.doc.nodeAt(pos)
        if (!node) return
        const endPos = pos + node.nodeSize

        // 提取块内的纯文本内容
        const textContent = node.textContent

        // 用 tr 删除旧块，插入目标类型的新块
        const { tr, schema } = editor.state
        tr.delete(pos, endPos)

        let newNode
        switch (type) {
            case 'paragraph':
                newNode = schema.nodes.paragraph.create(null,
                    textContent ? schema.text(textContent) : null)
                break
            case 'heading':
                newNode = schema.nodes.heading.create({ level: level || 1 },
                    textContent ? schema.text(textContent) : null)
                break
            case 'bulletList':
                newNode = schema.nodes.bulletList.create(null,
                    schema.nodes.listItem.create(null,
                        schema.nodes.paragraph.create(null,
                            textContent ? schema.text(textContent) : null)))
                break
            case 'orderedList':
                newNode = schema.nodes.orderedList.create(null,
                    schema.nodes.listItem.create(null,
                        schema.nodes.paragraph.create(null,
                            textContent ? schema.text(textContent) : null)))
                break
            case 'taskList':
                newNode = schema.nodes.taskList.create(null,
                    schema.nodes.taskItem.create({ checked: false },
                        schema.nodes.paragraph.create(null,
                            textContent ? schema.text(textContent) : null)))
                break
            case 'blockquote':
                newNode = schema.nodes.blockquote.create(null,
                    schema.nodes.paragraph.create(null,
                        textContent ? schema.text(textContent) : null))
                break
            case 'codeBlock':
                newNode = schema.nodes.codeBlock.create(null,
                    textContent ? schema.text(textContent) : null)
                break
        }

        if (newNode) {
            tr.insert(pos, newNode)
            editor.view.dispatch(tr)
            // 把光标放到新块内部
            editor.commands.setTextSelection(pos + 1)
        }
        closeMenu()
    }

    if (!editor) return null

    return (
        <div
            ref={containerRef}
            className="absolute z-40 transition-opacity duration-200 flex items-center"
            style={{
                top: handlePos.top,
                left: handlePos.left,
                opacity: handlePos.top === -999 ? 0 : 1,
                pointerEvents: handlePos.top === -999 ? 'none' : 'auto'
            }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
        >
            <Popover.Root open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setShowConvertMenu(false) }}>
                <Popover.Trigger asChild>
                    <button className="w-8 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded cursor-grab active:cursor-grabbing outline-none">
                        <GripVertical className="w-5 h-5" />
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        className="bg-white rounded-lg shadow-xl border border-gray-100 p-1 flex z-50 origin-top-left outline-none text-sm"
                        sideOffset={5}
                        align="start"
                    >
                        {/* 主菜单 */}
                        <div className="w-52 flex flex-col">
                            {/* 块类型转换 */}
                            <button
                                className="flex items-center justify-between px-3 py-1.5 text-gray-600 hover:bg-gray-50 rounded-md transition-colors w-full text-left"
                                onMouseEnter={() => setShowConvertMenu(true)}
                            >
                                <span className="flex items-center">
                                    <Type className="w-4 h-4 mr-3 text-gray-400" />
                                    转换为
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                            </button>

                            <div className="h-px bg-gray-100 my-1" />

                            {/* 剪切 / 复制 / 粘贴区 */}
                            <MenuItem icon={Scissors} label="剪切" shortcut="⌘X" onClick={handleCut} />
                            <MenuItem icon={Copy} label="复制" shortcut="⌘C" onClick={handleCopy} />
                            <MenuItem icon={FileText} label="复制为纯文本" onClick={handleCopyAsText} />
                            <MenuItem icon={Code} label="复制为 Markdown" onClick={handleCopyAsMarkdown} />

                            <div className="h-px bg-gray-100 my-1" />

                            {/* 块操作区 */}
                            <MenuItem icon={CopyPlus} label="复制块" shortcut="⌘D" onClick={handleDuplicate} />
                            <MenuItem icon={ArrowUpToLine} label="向上移动" onClick={handleMoveUp} />
                            <MenuItem icon={ArrowDownToLine} label="向下移动" onClick={handleMoveDown} />
                            <MenuItem icon={Plus} label="在下方插入" onClick={handleAddBelow} />

                            <div className="h-px bg-gray-100 my-1" />

                            {/* 删除 */}
                            <button className="flex items-center px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors w-full text-left" onClick={handleDelete}>
                                <Trash2 className="w-4 h-4 mr-3 text-red-400" />
                                删除
                                <span className="ml-auto text-xs text-red-300">Del</span>
                            </button>
                        </div>

                        {/* 转换子菜单 */}
                        {showConvertMenu && (
                            <div
                                className="w-48 flex flex-col border-l border-gray-100 pl-1"
                                onMouseLeave={() => setShowConvertMenu(false)}
                            >
                                <ConvertItem icon={Pilcrow} label="正文" onClick={() => handleConvert('paragraph')} />
                                <ConvertItem icon={Heading1} label="一级标题" onClick={() => handleConvert('heading', 1)} />
                                <ConvertItem icon={Heading2} label="二级标题" onClick={() => handleConvert('heading', 2)} />
                                <ConvertItem icon={Heading3} label="三级标题" onClick={() => handleConvert('heading', 3)} />
                                <div className="h-px bg-gray-100 my-1" />
                                <ConvertItem icon={List} label="无序列表" onClick={() => handleConvert('bulletList')} />
                                <ConvertItem icon={ListOrdered} label="有序列表" onClick={() => handleConvert('orderedList')} />
                                <ConvertItem icon={ListChecks} label="待办列表" onClick={() => handleConvert('taskList')} />
                                <div className="h-px bg-gray-100 my-1" />
                                <ConvertItem icon={Quote} label="引用" onClick={() => handleConvert('blockquote')} />
                                <ConvertItem icon={Code} label="代码块" onClick={() => handleConvert('codeBlock')} />
                            </div>
                        )}
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    )
}
