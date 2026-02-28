import { useEffect, useState, useRef, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import * as Popover from '@radix-ui/react-popover'
import {
    GripVertical, Plus, Trash2, Copy, Scissors, ArrowDownToLine,
    ArrowUpToLine, CopyPlus, Type, Heading1, Heading2, Heading3,
    List, ListOrdered, ListChecks, Quote, Code, ChevronRight,
    FileText, Pilcrow, ChevronsUpDown, Minus
} from 'lucide-react'

import type { LucideIcon } from 'lucide-react'

const MenuItem = ({ icon: Icon, label, shortcut, onClick, focused }: { icon: LucideIcon; label: string; shortcut?: string; onClick: () => void; focused?: boolean }) => (
    <button
        className={`flex items-center px-3 py-1.5 text-gray-600 rounded-md transition-colors w-full text-left ${focused ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
        onClick={onClick}
        data-focused={focused || undefined}
    >
        <Icon className="w-4 h-4 mr-3 text-gray-400" />
        {label}
        {shortcut && <span className="ml-auto text-xs text-gray-300">{shortcut}</span>}
    </button>
)

const ConvertItem = ({ icon: Icon, label, shortcut, onClick, focused }: { icon: LucideIcon; label: string; shortcut?: string; onClick: () => void; focused?: boolean }) => (
    <button
        className={`flex items-center px-3 py-1.5 text-gray-600 rounded-md transition-colors w-full text-left ${focused ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
        onClick={onClick}
        data-focused={focused || undefined}
    >
        <Icon className="w-4 h-4 mr-3 text-gray-400" />
        {label}
        {shortcut && <span className="ml-auto text-xs text-gray-300">{shortcut}</span>}
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

            // 表格有自己的行列操作手柄，不显示 BlockHandle
            if (topNode.type.name === 'table') {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
                return
            }

            // 从文档位置反查 DOM 节点，向上查找到编辑器直接子元素
            let domNode = view.nodeDOM(topNodePos) as HTMLElement | null
            if (!domNode || !view.dom.contains(domNode)) {
                setHandlePos({ top: -999, left: -999 })
                setHoveredNode(null)
                return
            }
            while (domNode && domNode.parentElement !== view.dom) {
                domNode = domNode.parentElement
            }
            if (!domNode) {
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

            const isTargetCollapsed = target.classList.contains('doco-collapsed')
            let firstLineCenter: number
            if (isTargetCollapsed) {
                firstLineCenter = rect.top + rect.height / 2
            } else {
                const computedStyle = window.getComputedStyle(target)
                const lineHeightStr = computedStyle.lineHeight
                const fontSize = parseFloat(computedStyle.fontSize) || 16
                const lineHeight = parseFloat(lineHeightStr) || fontSize * 1.2
                const paddingTop = parseFloat(computedStyle.paddingTop) || 0
                firstLineCenter = rect.top + paddingTop + Math.min(lineHeight, rect.height) / 2
            }

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

    const closeMenu = () => { setIsOpen(false); setShowConvertMenu(false); setFocusIndex(-1) }

    // 判断当前块是否已折叠
    const isCollapsed = (): boolean => {
        const pos = getNodePos()
        if (pos === null) return false
        return ((editor.storage as any).collapse?.collapsed as Set<number>)?.has(pos) ?? false
    }

    // 判断当前块是否可折叠（多行内容才可以）
    const canCollapse = (): boolean => {
        if (!hoveredNode) return false
        if (isCollapsed()) return true
        return hoveredNode.scrollHeight > 60
    }

    const handleToggleCollapse = () => {
        const pos = getNodePos()
        if (pos === null) return
        ;(editor.commands as any).toggleCollapse(pos)
        closeMenu()
    }

    // ---- 键盘导航 ----
    const [focusIndex, setFocusIndex] = useState(-1)
    const menuRef = useRef<HTMLDivElement>(null)
    const convertMenuRef = useRef<HTMLDivElement>(null)

    // 主菜单项定义（用于键盘导航索引）
    const showCollapse = canCollapse()
    const MAIN_MENU_COUNT = showCollapse ? 11 : 10
    const CONVERT_MENU_COUNT = 10

    // 菜单打开时重置焦点并聚焦容器
    useEffect(() => {
        if (isOpen) {
            setFocusIndex(0)
            setTimeout(() => menuRef.current?.focus(), 0)
        } else {
            setFocusIndex(-1)
        }
    }, [isOpen])

    // 子菜单打开时重置焦点并聚焦
    useEffect(() => {
        if (showConvertMenu) {
            setFocusIndex(0)
            setTimeout(() => convertMenuRef.current?.focus(), 0)
        }
    }, [showConvertMenu])

    // 主菜单项 action 映射（与渲染顺序一致，动态包含折叠项）
    const getMainActions = useCallback(() => {
        const actions: (() => void)[] = [
            () => { setShowConvertMenu(true) },
        ]
        if (showCollapse) actions.push(handleToggleCollapse)
        actions.push(
            handleCut, handleCopy, handleCopyAsText, handleCopyAsMarkdown,
            handleDuplicate, handleMoveUp, handleMoveDown, handleAddBelow,
            handleDelete,
        )
        return actions
    }, [showCollapse])

    // 转换子菜单项 action 映射
    const getConvertActions = useCallback(() => [
        () => handleConvert('paragraph'),
        () => handleConvert('heading', 1),
        () => handleConvert('heading', 2),
        () => handleConvert('heading', 3),
        () => handleConvert('bulletList'),
        () => handleConvert('orderedList'),
        () => handleConvert('taskList'),
        () => handleConvert('blockquote'),
        () => handleConvert('codeBlock'),
        () => handleConvert('horizontalRule'),
    ], [])

    const handleMainKeyDown = useCallback((e: React.KeyboardEvent) => {
        const count = MAIN_MENU_COUNT
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setFocusIndex(i => (i + 1) % count)
                break
            case 'ArrowUp':
                e.preventDefault()
                setFocusIndex(i => (i - 1 + count) % count)
                break
            case 'Enter':
            case ' ':
                e.preventDefault()
                if (focusIndex >= 0) getMainActions()[focusIndex]?.()
                break
            case 'ArrowRight':
                if (focusIndex === 0) { e.preventDefault(); setShowConvertMenu(true) }
                break
            case 'Escape':
                e.preventDefault()
                closeMenu()
                break
        }
    }, [focusIndex])

    const handleConvertKeyDown = useCallback((e: React.KeyboardEvent) => {
        const count = CONVERT_MENU_COUNT
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setFocusIndex(i => (i + 1) % count)
                break
            case 'ArrowUp':
                e.preventDefault()
                setFocusIndex(i => (i - 1 + count) % count)
                break
            case 'Enter':
            case ' ':
                e.preventDefault()
                if (focusIndex >= 0) getConvertActions()[focusIndex]?.()
                break
            case 'ArrowLeft':
            case 'Escape':
                e.preventDefault()
                setShowConvertMenu(false)
                setFocusIndex(0)
                setTimeout(() => menuRef.current?.focus(), 0)
                break
        }
    }, [focusIndex])

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

        // 代码块转正文时，如果语言是 markdown，解析为富文本
        if (type === 'paragraph' && node.type.name === 'codeBlock' && node.attrs.language === 'markdown' && textContent) {
            const { tr } = editor.state
            tr.delete(pos, endPos)
            editor.view.dispatch(tr)
            const parsed = (editor.storage as any).markdown?.parser?.parse(textContent)
            if (parsed) {
                editor.commands.insertContentAt(pos, parsed)
            }
            closeMenu()
            return
        }

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
            case 'horizontalRule':
                newNode = schema.nodes.horizontalRule.create()
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

    const fi = showConvertMenu ? -1 : focusIndex // 主菜单焦点（子菜单打开时禁用）
    const ci = showConvertMenu ? focusIndex : -1  // 子菜单焦点
    const o = showCollapse ? 1 : 0 // 折叠项占位偏移

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
                        onOpenAutoFocus={e => e.preventDefault()}
                    >
                        {/* 主菜单 */}
                        <div
                            ref={menuRef}
                            className="w-52 flex flex-col outline-none"
                            tabIndex={-1}
                            onKeyDown={!showConvertMenu ? handleMainKeyDown : undefined}
                        >
                            {/* 块类型转换 */}
                            <button
                                className={`flex items-center justify-between px-3 py-1.5 text-gray-600 rounded-md transition-colors w-full text-left ${fi === 0 ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                onMouseEnter={() => { setShowConvertMenu(true) }}
                                onFocus={() => setFocusIndex(0)}
                            >
                                <span className="flex items-center">
                                    <Type className="w-4 h-4 mr-3 text-gray-400" />
                                    转换为
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                            </button>

                            <div className="h-px bg-gray-100 my-1" />

                            {/* 折叠/展开（仅多行块显示） */}
                            {showCollapse && (
                                <>
                                    <MenuItem icon={ChevronsUpDown} label={isCollapsed() ? '展开' : '折叠'} onClick={handleToggleCollapse} focused={fi === 1} />
                                    <div className="h-px bg-gray-100 my-1" />
                                </>
                            )}

                            {/* 剪切 / 复制 / 粘贴区 */}
                            <MenuItem icon={Scissors} label="剪切" shortcut="⌘X" onClick={handleCut} focused={fi === 1 + o} />
                            <MenuItem icon={Copy} label="复制" shortcut="⌘C" onClick={handleCopy} focused={fi === 2 + o} />
                            <MenuItem icon={FileText} label="复制为纯文本" onClick={handleCopyAsText} focused={fi === 3 + o} />
                            <MenuItem icon={Code} label="复制为 Markdown" onClick={handleCopyAsMarkdown} focused={fi === 4 + o} />

                            <div className="h-px bg-gray-100 my-1" />

                            {/* 块操作区 */}
                            <MenuItem icon={CopyPlus} label="复制块" shortcut="⌘D" onClick={handleDuplicate} focused={fi === 5 + o} />
                            <MenuItem icon={ArrowUpToLine} label="向上移动" shortcut="⌥↑" onClick={handleMoveUp} focused={fi === 6 + o} />
                            <MenuItem icon={ArrowDownToLine} label="向下移动" shortcut="⌥↓" onClick={handleMoveDown} focused={fi === 7 + o} />
                            <MenuItem icon={Plus} label="在下方插入" shortcut="⌘⏎" onClick={handleAddBelow} focused={fi === 8 + o} />

                            <div className="h-px bg-gray-100 my-1" />

                            {/* 删除 */}
                            <button
                                className={`flex items-center px-3 py-1.5 text-red-600 rounded-md transition-colors w-full text-left ${fi === 9 + o ? 'bg-red-50' : 'hover:bg-red-50'}`}
                                onClick={handleDelete}
                            >
                                <Trash2 className="w-4 h-4 mr-3 text-red-400" />
                                删除
                                <span className="ml-auto text-xs text-red-300">Del</span>
                            </button>
                        </div>

                        {/* 转换子菜单 */}
                        {showConvertMenu && (
                            <div
                                ref={convertMenuRef}
                                className="w-48 flex flex-col border-l border-gray-100 pl-1 outline-none"
                                tabIndex={-1}
                                onKeyDown={handleConvertKeyDown}
                                onMouseLeave={() => setShowConvertMenu(false)}
                            >
                                <ConvertItem icon={Pilcrow} label="正文" onClick={() => handleConvert('paragraph')} focused={ci === 0} />
                                <ConvertItem icon={Heading1} label="一级标题" shortcut="⌘⌥1" onClick={() => handleConvert('heading', 1)} focused={ci === 1} />
                                <ConvertItem icon={Heading2} label="二级标题" shortcut="⌘⌥2" onClick={() => handleConvert('heading', 2)} focused={ci === 2} />
                                <ConvertItem icon={Heading3} label="三级标题" shortcut="⌘⌥3" onClick={() => handleConvert('heading', 3)} focused={ci === 3} />
                                <div className="h-px bg-gray-100 my-1" />
                                <ConvertItem icon={List} label="无序列表" onClick={() => handleConvert('bulletList')} focused={ci === 4} />
                                <ConvertItem icon={ListOrdered} label="有序列表" onClick={() => handleConvert('orderedList')} focused={ci === 5} />
                                <ConvertItem icon={ListChecks} label="待办列表" onClick={() => handleConvert('taskList')} focused={ci === 6} />
                                <div className="h-px bg-gray-100 my-1" />
                                <ConvertItem icon={Quote} label="引用" onClick={() => handleConvert('blockquote')} focused={ci === 7} />
                                <ConvertItem icon={Code} label="代码块" onClick={() => handleConvert('codeBlock')} focused={ci === 8} />
                                <ConvertItem icon={Minus} label="分隔线" onClick={() => handleConvert('horizontalRule')} focused={ci === 9} />
                            </div>
                        )}
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    )
}
