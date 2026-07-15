import { Extension } from '@tiptap/core'
import { convertSelectedBlocks, getTopLevelSelection, toggleCurrentBlockCollapse } from '../editorBlockCommands'
import { EDITOR_SHORTCUTS } from '../editorShortcuts'

type MarkdownStorage = { getMarkdown?: () => string }

/**
 * 获取当前光标所在的顶层块节点位置
 */
function getCursorBlockPos(state: any): { pos: number; node: any; index: number } | null {
    const { selection, doc } = state
    const $pos = doc.resolve(selection.from)
    if ($pos.depth < 1) return null
    const pos = $pos.before(1)
    const node = doc.nodeAt(pos)
    if (!node) return null
    const index = $pos.index(0)
    return { pos, node, index }
}

export const KeyboardShortcuts = Extension.create({
    name: 'keyboardShortcuts',

    addKeyboardShortcuts() {
        return {
            // Alt+Up: 向上移动当前块
            [EDITOR_SHORTCUTS.moveUp]: ({ editor }) => {
                const block = getCursorBlockPos(editor.state)
                if (!block || block.index === 0) return false
                const { pos, node, index } = block
                const prevNode = editor.state.doc.child(index - 1)
                const prevPos = pos - prevNode.nodeSize
                const { tr } = editor.state
                tr.replaceWith(prevPos, pos + node.nodeSize,
                    [node.copy(node.content), prevNode.copy(prevNode.content)])
                editor.view.dispatch(tr)
                return true
            },

            // Alt+Down: 向下移动当前块
            [EDITOR_SHORTCUTS.moveDown]: ({ editor }) => {
                const block = getCursorBlockPos(editor.state)
                if (!block) return false
                const { pos, node, index } = block
                if (index >= editor.state.doc.childCount - 1) return false
                const nextNode = editor.state.doc.child(index + 1)
                const endPos = pos + node.nodeSize + nextNode.nodeSize
                const { tr } = editor.state
                tr.replaceWith(pos, endPos,
                    [nextNode.copy(nextNode.content), node.copy(node.content)])
                editor.view.dispatch(tr)
                return true
            },

            // Cmd+D: 复制当前块
            [EDITOR_SHORTCUTS.duplicate]: ({ editor }) => {
                const block = getCursorBlockPos(editor.state)
                if (!block) return false
                const { pos, node } = block
                const { tr } = editor.state
                tr.insert(pos + node.nodeSize, node.copy(node.content))
                editor.view.dispatch(tr)
                return true
            },

            // Cmd+Enter: 在当前块下方插入新段落
            [EDITOR_SHORTCUTS.addBelow]: ({ editor }) => {
                const block = getCursorBlockPos(editor.state)
                if (!block) return false
                const { pos, node } = block
                const insertPos = pos + node.nodeSize
                editor.chain()
                    .insertContentAt(insertPos, { type: 'paragraph' })
                    .focus(insertPos + 1)
                    .run()
                return true
            },

            [EDITOR_SHORTCUTS.bold]: ({ editor }) => {
                editor.chain().focus().toggleBold().run()
                return true
            },

            [EDITOR_SHORTCUTS.italic]: ({ editor }) => {
                editor.chain().focus().toggleItalic().run()
                return true
            },

            [EDITOR_SHORTCUTS.underline]: ({ editor }) => {
                editor.chain().focus().toggleUnderline().run()
                return true
            },

            [EDITOR_SHORTCUTS.strike]: ({ editor }) => {
                editor.chain().focus().toggleStrike().run()
                return true
            },

            [EDITOR_SHORTCUTS.inlineCode]: ({ editor }) => {
                editor.chain().focus().toggleCode().run()
                return true
            },

            // Cmd+Shift+H: 切换高亮
            [EDITOR_SHORTCUTS.highlight]: ({ editor }) => {
                (editor.chain().focus() as any).toggleHighlight().run()
                return true
            },

            // Cmd+Shift+L: 左对齐
            [EDITOR_SHORTCUTS.alignLeft]: ({ editor }) => {
                (editor.chain().focus() as any).setTextAlign('left').run()
                return true
            },

            // Cmd+Shift+e: 居中对齐
            [EDITOR_SHORTCUTS.alignCenter]: ({ editor }) => {
                (editor.chain().focus() as any).setTextAlign('center').run()
                return true
            },

            // Cmd+Shift+r: 右对齐
            [EDITOR_SHORTCUTS.alignRight]: ({ editor }) => {
                (editor.chain().focus() as any).setTextAlign('right').run()
                return true
            },

            // Cmd+Alt+1/2/3: 标题快捷键
            [EDITOR_SHORTCUTS.heading1]: ({ editor }) =>
                convertSelectedBlocks(editor, 'heading', 1),
            [EDITOR_SHORTCUTS.heading2]: ({ editor }) =>
                convertSelectedBlocks(editor, 'heading', 2),
            [EDITOR_SHORTCUTS.heading3]: ({ editor }) =>
                convertSelectedBlocks(editor, 'heading', 3),

            // Cmd+Alt+0: 转为正文
            [EDITOR_SHORTCUTS.paragraph]: ({ editor }) =>
                convertSelectedBlocks(editor, 'paragraph'),

            [EDITOR_SHORTCUTS.bulletList]: ({ editor }) =>
                convertSelectedBlocks(editor, 'bulletList'),

            [EDITOR_SHORTCUTS.orderedList]: ({ editor }) =>
                convertSelectedBlocks(editor, 'orderedList'),

            [EDITOR_SHORTCUTS.taskList]: ({ editor }) =>
                convertSelectedBlocks(editor, 'taskList'),

            [EDITOR_SHORTCUTS.blockquote]: ({ editor }) =>
                convertSelectedBlocks(editor, 'blockquote'),

            [EDITOR_SHORTCUTS.codeBlock]: ({ editor }) =>
                convertSelectedBlocks(editor, 'codeBlock'),

            [EDITOR_SHORTCUTS.calloutBlock]: ({ editor }) =>
                convertSelectedBlocks(editor, 'calloutBlock'),

            [EDITOR_SHORTCUTS.horizontalRule]: ({ editor }) =>
                convertSelectedBlocks(editor, 'horizontalRule'),

            [EDITOR_SHORTCUTS.copyAsText]: ({ editor }) => {
                const selection = editor.state.selection
                const blockRange = getTopLevelSelection(editor)
                const from = selection.empty ? blockRange?.from : selection.from
                const to = selection.empty ? blockRange?.to : selection.to
                if (from === undefined || to === undefined) return false
                const text = editor.state.doc.textBetween(from, to, '\n')
                if (!text) return false
                void navigator.clipboard.writeText(text)
                return true
            },

            [EDITOR_SHORTCUTS.copyAsMarkdown]: ({ editor }) => {
                const selection = editor.state.selection
                const blockRange = getTopLevelSelection(editor)
                const from = selection.empty ? blockRange?.from : selection.from
                const to = selection.empty ? blockRange?.to : selection.to
                if (from === undefined || to === undefined) return false
                const text = editor.state.doc.textBetween(from, to, '\n')
                if (!text) return false
                const markdownStorage = editor.storage.markdown as MarkdownStorage | undefined
                const markdown = markdownStorage?.getMarkdown?.() || text
                const lines = markdown.split('\n')
                const firstLine = text.split('\n')[0]?.slice(0, 20)
                const matched = firstLine
                    ? lines.filter((line: string) => line.includes(firstLine))
                    : []
                void navigator.clipboard.writeText(matched.length ? matched.join('\n') : text)
                return true
            },

            [EDITOR_SHORTCUTS.collapse]: ({ editor }) =>
                toggleCurrentBlockCollapse(editor),

            // Delete / Backspace 删除选中的块节点
            [EDITOR_SHORTCUTS.delete]: ({ editor }) => {
                const { selection } = editor.state
                if ((selection as any).node) {
                    const { tr } = editor.state
                    tr.delete(selection.from, selection.to)
                    editor.view.dispatch(tr)
                    return true
                }
                return false
            },

            // Cmd+Alt+Shift+J: 切换标题多级编号
            'Mod-Alt-Shift-j': () => {
                window.dispatchEvent(new CustomEvent('toggle-heading-numbered'))
                return true
            },

            // Cmd+K: 添加/编辑链接（通过自定义事件触发弹层）
            [EDITOR_SHORTCUTS.link]: ({ editor }) => {
                const coords = editor.view.coordsAtPos(editor.state.selection.from)
                const existingHref = editor.getAttributes('link').href || ''
                window.dispatchEvent(new CustomEvent('editor-link-edit', {
                    detail: { top: coords.top - 44, left: coords.left, href: existingHref }
                }))
                return true
            },
        }
    },
})
