import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from '@tiptap/react'
import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react/menus'
import * as Popover from '@radix-ui/react-popover'
import {
    AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine,
    Bold, Check, ChevronDown, Code, Copy, CopyPlus, FileText, Highlighter,
    Italic, Lightbulb, Link as LinkIcon, List, ListChecks, ListOrdered,
    Minus, MoreHorizontal, Pilcrow, Plus, Quote, Scissors, Strikethrough,
    Trash2, Type, Underline, ChevronsUpDown, Heading1, Heading2, Heading3,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LinkPopover } from './LinkPopover'
import {
    convertSelectedBlocks, duplicateSelectedBlocks, getTopLevelSelection,
    insertParagraphBelow, moveSelectedBlocks, toggleCurrentBlockCollapse,
    type ConvertibleBlock,
} from '../editorBlockCommands'
import { actionTooltip, shortcutLabel, type EditorShortcutId } from '../editorShortcuts'

type MarkdownStorage = { getMarkdown?: () => string }

type ToolbarButtonProps = {
    icon: LucideIcon
    label: string
    shortcut?: EditorShortcutId
    active?: boolean
    danger?: boolean
    onClick?: () => void
}

const ToolbarButton = ({ icon: Icon, label, shortcut, active, danger, onClick }: ToolbarButtonProps) => (
    <button
        type="button"
        onClick={onClick}
        className={`p-2 m-0.5 rounded-lg transition-colors outline-none
            ${danger ? 'text-[#b53333] hover:bg-[#f8ebe6]' : 'text-[#5e5d59] hover:bg-[#e8e6dc]'}
            ${active ? 'bg-[#e8e6dc] text-[#c96442] ring-1 ring-[#d1cfc5]' : ''}`}
        title={actionTooltip(label, shortcut)}
        aria-label={actionTooltip(label, shortcut)}
    >
        <Icon className="w-4 h-4" />
    </button>
)

type MenuActionProps = {
    icon: LucideIcon
    label: string
    shortcut: EditorShortcutId
    active?: boolean
    disabled?: boolean
    disabledReason?: string
    danger?: boolean
    onClick: () => void
}

const MenuAction = ({ icon: Icon, label, shortcut, active, disabled, disabledReason, danger, onClick }: MenuActionProps) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={actionTooltip(label, shortcut, disabled ? disabledReason : undefined)}
        className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors
            ${disabled ? 'cursor-not-allowed text-[#b0aea5]' : danger ? 'text-[#b53333] hover:bg-[#f8ebe6]' : 'text-[#4d4c48] hover:bg-[#f0eee6]'}
            ${active ? 'bg-[#e8e6dc]' : ''}`}
    >
        <Icon className="w-4 h-4 shrink-0 opacity-70" />
        <span className="flex-1">{label}</span>
        {active && <Check className="w-3.5 h-3.5 text-[#c96442]" />}
        <kbd className="font-sans text-[13px] leading-none font-medium tracking-[0.01em] text-[#5e5d59]">
            {shortcutLabel(shortcut)}
        </kbd>
    </button>
)

const MenuDivider = () => <div className="h-px bg-[#e8e6dc] my-1" />

export const FloatingToolbar = ({ editor }: { editor: Editor }) => {
    const [linkPopover, setLinkPopover] = useState<{ top: number; left: number } | null>(null)
    const [typeOpen, setTypeOpen] = useState(false)
    const [alignOpen, setAlignOpen] = useState(false)
    const [moreOpen, setMoreOpen] = useState(false)
    const [, forceUpdate] = useState({})
    const toolbarRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleUpdate = () => forceUpdate({})
        editor.on('selectionUpdate', handleUpdate)
        editor.on('transaction', handleUpdate)
        return () => {
            editor.off('selectionUpdate', handleUpdate)
            editor.off('transaction', handleUpdate)
        }
    }, [editor])

    const selectionRange = getTopLevelSelection(editor)
    const isSingleBlock = selectionRange?.count === 1
    const singleBlockReason = '跨块选择时不可用'

    const shouldShowBubbleMenu = useCallback(({ editor, state }: {
        editor: Editor
        state: Editor['state']
    }) => {
        const { from, to } = state.selection
        return (from !== to || editor.isActive('image'))
            && !editor.isActive('codeBlock')
            && !editor.isActive('mermaidBlock')
            && !editor.isActive('plantUMLBlock')
            && !editor.isActive('spreadsheetBlock')
    }, [])

    const refocusEditorAfterMenuClose = () => {
        requestAnimationFrame(() => editor.commands.focus())
    }

    const closeMoreMenu = () => {
        setMoreOpen(false)
        refocusEditorAfterMenuClose()
    }

    const openLink = () => {
        const { from } = editor.state.selection
        const coords = editor.view.coordsAtPos(from)
        setLinkPopover({ top: coords.top - 44, left: coords.left })
    }

    const convert = (type: ConvertibleBlock, level?: number) => {
        convertSelectedBlocks(editor, type, level)
        setTypeOpen(false)
        refocusEditorAfterMenuClose()
    }

    const copySelectionAsText = () => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, '\n')
        if (text) void navigator.clipboard.writeText(text)
        closeMoreMenu()
    }

    const copySelectionAsMarkdown = () => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, '\n')
        const markdownStorage = editor.storage.markdown as MarkdownStorage | undefined
        const markdown = markdownStorage?.getMarkdown?.() || text
        const firstLine = text.split('\n')[0]?.slice(0, 20)
        const matched = firstLine
            ? markdown.split('\n').filter((line: string) => line.includes(firstLine))
            : []
        void navigator.clipboard.writeText(matched.length ? matched.join('\n') : text)
        closeMoreMenu()
    }

    const nativeClipboardAction = (command: 'cut' | 'copy') => {
        editor.commands.focus()
        document.execCommand(command)
        closeMoreMenu()
    }

    const blockTypeItems: Array<{
        icon: LucideIcon
        label: string
        shortcut: EditorShortcutId
        type: ConvertibleBlock
        level?: number
        active: boolean
        dividerBefore?: boolean
    }> = [
        { icon: Pilcrow, label: '正文', shortcut: 'paragraph', type: 'paragraph', active: editor.isActive('paragraph') },
        { icon: Heading1, label: '一级标题', shortcut: 'heading1', type: 'heading', level: 1, active: editor.isActive('heading', { level: 1 }) },
        { icon: Heading2, label: '二级标题', shortcut: 'heading2', type: 'heading', level: 2, active: editor.isActive('heading', { level: 2 }) },
        { icon: Heading3, label: '三级标题', shortcut: 'heading3', type: 'heading', level: 3, active: editor.isActive('heading', { level: 3 }) },
        { icon: List, label: '无序列表', shortcut: 'bulletList', type: 'bulletList', active: editor.isActive('bulletList'), dividerBefore: true },
        { icon: ListOrdered, label: '有序列表', shortcut: 'orderedList', type: 'orderedList', active: editor.isActive('orderedList') },
        { icon: ListChecks, label: '待办列表', shortcut: 'taskList', type: 'taskList', active: editor.isActive('taskList') },
        { icon: Quote, label: '引用', shortcut: 'blockquote', type: 'blockquote', active: editor.isActive('blockquote'), dividerBefore: true },
        { icon: Code, label: '代码块', shortcut: 'codeBlock', type: 'codeBlock', active: editor.isActive('codeBlock') },
        { icon: Lightbulb, label: '高亮块', shortcut: 'calloutBlock', type: 'calloutBlock', active: editor.isActive('calloutBlock') },
        { icon: Minus, label: '分隔线', shortcut: 'horizontalRule', type: 'horizontalRule', active: editor.isActive('horizontalRule') },
    ]

    const textButtons: ToolbarButtonProps[] = [
        { icon: Bold, label: '加粗', shortcut: 'bold', active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
        { icon: Italic, label: '斜体', shortcut: 'italic', active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
        { icon: Underline, label: '下划线', shortcut: 'underline', active: editor.isActive('underline'), onClick: () => editor.chain().focus().toggleUnderline().run() },
        { icon: Strikethrough, label: '删除线', shortcut: 'strike', active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
        { icon: Code, label: '行内代码', shortcut: 'inlineCode', active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run() },
        { icon: Highlighter, label: '高亮', shortcut: 'highlight', active: editor.isActive('highlight'), onClick: () => editor.chain().focus().toggleHighlight().run() },
        { icon: LinkIcon, label: '链接', shortcut: 'link', active: editor.isActive('link') || !!linkPopover, onClick: openLink },
    ]

    const isImage = editor.isActive('image')
    const isUnsupportedBlock = editor.isActive('codeBlock')
        || editor.isActive('mermaidBlock') || editor.isActive('plantUMLBlock')

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
                shouldShow={shouldShowBubbleMenu}
                className="flex overflow-visible border border-[#e8e6dc] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] bg-[#faf9f5] z-50"
            >
                <div ref={toolbarRef} className="flex px-1 items-center outline-none">
                    {!isImage && !isUnsupportedBlock && (
                        <>
                            <Popover.Root open={typeOpen} onOpenChange={setTypeOpen}>
                                <Popover.Trigger asChild>
                                    <button
                                        type="button"
                                        className="flex items-center gap-0.5 p-2 m-0.5 rounded-lg text-[#5e5d59] hover:bg-[#e8e6dc] outline-none"
                                        title="转换块类型"
                                        aria-label="打开块类型转换菜单"
                                    >
                                        <Type className="w-4 h-4" />
                                        <ChevronDown className="w-3 h-3" />
                                    </button>
                                </Popover.Trigger>
                                <Popover.Portal>
                                    <Popover.Content
                                        sideOffset={8}
                                        align="start"
                                        onOpenAutoFocus={event => event.preventDefault()}
                                        onCloseAutoFocus={event => event.preventDefault()}
                                        className="z-[60] w-56 max-h-[360px] overflow-y-auto rounded-xl border border-[#e8e6dc] bg-[#faf9f5] p-1.5 text-sm shadow-[0_4px_24px_rgba(0,0,0,0.10)] outline-none"
                                    >
                                        {blockTypeItems.map(item => (
                                            <Fragment key={item.shortcut}>
                                                {item.dividerBefore && <MenuDivider />}
                                                <MenuAction
                                                    {...item}
                                                    disabled={item.type === 'horizontalRule' && !isSingleBlock}
                                                    disabledReason="选择多行时不可转换为分隔线"
                                                    onClick={() => convert(item.type, item.level)}
                                                />
                                            </Fragment>
                                        ))}
                                    </Popover.Content>
                                </Popover.Portal>
                            </Popover.Root>
                            <div className="w-px h-5 bg-[#e8e6dc] mx-0.5" />
                            {textButtons.map(item => <ToolbarButton key={item.shortcut} {...item} />)}
                            <div className="w-px h-5 bg-[#e8e6dc] mx-0.5" />
                        </>
                    )}

                    <Popover.Root open={alignOpen} onOpenChange={setAlignOpen}>
                        <Popover.Trigger
                            className="p-2 m-0.5 rounded-lg text-[#5e5d59] hover:bg-[#e8e6dc] outline-none"
                            title="对齐方式"
                            aria-label="打开对齐方式菜单"
                        >
                            <AlignLeft className="w-4 h-4" />
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content
                                sideOffset={8}
                                align="end"
                                onOpenAutoFocus={event => event.preventDefault()}
                                onCloseAutoFocus={event => event.preventDefault()}
                                className="z-[60] w-48 rounded-xl border border-[#e8e6dc] bg-[#faf9f5] p-1.5 text-sm shadow-[0_4px_24px_rgba(0,0,0,0.10)] outline-none"
                            >
                                <MenuAction icon={AlignLeft} label="左对齐" shortcut="alignLeft" active={editor.isActive({ textAlign: 'left' })} onClick={() => { editor.chain().focus().setTextAlign('left').run(); setAlignOpen(false); refocusEditorAfterMenuClose() }} />
                                <MenuAction icon={AlignCenter} label="居中对齐" shortcut="alignCenter" active={editor.isActive({ textAlign: 'center' })} onClick={() => { editor.chain().focus().setTextAlign('center').run(); setAlignOpen(false); refocusEditorAfterMenuClose() }} />
                                <MenuAction icon={AlignRight} label="右对齐" shortcut="alignRight" active={editor.isActive({ textAlign: 'right' })} onClick={() => { editor.chain().focus().setTextAlign('right').run(); setAlignOpen(false); refocusEditorAfterMenuClose() }} />
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>

                    {!isImage && (
                        <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
                            <Popover.Trigger
                                className="p-2 m-0.5 rounded-lg text-[#5e5d59] hover:bg-[#e8e6dc] outline-none"
                                title="更多操作"
                                aria-label="打开更多操作菜单"
                            >
                                <MoreHorizontal className="w-4 h-4" />
                            </Popover.Trigger>
                            <Popover.Portal>
                                <Popover.Content
                                    sideOffset={8}
                                    align="end"
                                    onOpenAutoFocus={event => event.preventDefault()}
                                    onCloseAutoFocus={event => event.preventDefault()}
                                    className="z-[60] w-60 rounded-xl border border-[#e8e6dc] bg-[#faf9f5] p-1.5 text-sm shadow-[0_4px_24px_rgba(0,0,0,0.10)] outline-none"
                                >
                                    <MenuAction icon={Scissors} label="剪切" shortcut="cut" onClick={() => nativeClipboardAction('cut')} />
                                    <MenuAction icon={Copy} label="复制" shortcut="copy" onClick={() => nativeClipboardAction('copy')} />
                                    <MenuAction icon={FileText} label="复制为纯文本" shortcut="copyAsText" onClick={copySelectionAsText} />
                                    <MenuAction icon={Code} label="复制为 Markdown" shortcut="copyAsMarkdown" onClick={copySelectionAsMarkdown} />
                                    <MenuDivider />
                                    <MenuAction icon={CopyPlus} label="复制块" shortcut="duplicate" onClick={() => { duplicateSelectedBlocks(editor); closeMoreMenu() }} />
                                    <MenuAction icon={ArrowUpToLine} label="向上移动" shortcut="moveUp" onClick={() => { moveSelectedBlocks(editor, 'up'); closeMoreMenu() }} />
                                    <MenuAction icon={ArrowDownToLine} label="向下移动" shortcut="moveDown" onClick={() => { moveSelectedBlocks(editor, 'down'); closeMoreMenu() }} />
                                    <MenuAction icon={Plus} label="在下方插入" shortcut="addBelow" onClick={() => { insertParagraphBelow(editor); closeMoreMenu() }} />
                                    <MenuAction icon={ChevronsUpDown} label="折叠或展开" shortcut="collapse" disabled={!isSingleBlock} disabledReason={singleBlockReason} onClick={() => { toggleCurrentBlockCollapse(editor); closeMoreMenu() }} />
                                    <MenuDivider />
                                    <MenuAction icon={Trash2} label="删除所选内容" shortcut="delete" danger onClick={() => { editor.chain().focus().deleteSelection().run(); closeMoreMenu() }} />
                                </Popover.Content>
                            </Popover.Portal>
                        </Popover.Root>
                    )}

                    {isImage && <ToolbarButton icon={Trash2} label="删除" shortcut="delete" danger onClick={() => editor.chain().focus().deleteSelection().run()} />}
                </div>
            </TiptapBubbleMenu>
        </>
    )
}
