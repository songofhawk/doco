import { Extension } from '@tiptap/core'

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
            'Alt-ArrowUp': ({ editor }) => {
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
            'Alt-ArrowDown': ({ editor }) => {
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
            'Mod-d': ({ editor }) => {
                const block = getCursorBlockPos(editor.state)
                if (!block) return false
                const { pos, node } = block
                const { tr } = editor.state
                tr.insert(pos + node.nodeSize, node.copy(node.content))
                editor.view.dispatch(tr)
                return true
            },

            // Cmd+Enter: 在当前块下方插入新段落
            'Mod-Enter': ({ editor }) => {
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

            // Cmd+Shift+H: 切换高亮
            'Mod-Shift-h': ({ editor }) => {
                (editor.chain().focus() as any).toggleHighlight().run()
                return true
            },

            // Cmd+Shift+L: 左对齐
            'Mod-Shift-l': ({ editor }) => {
                (editor.chain().focus() as any).setTextAlign('left').run()
                return true
            },

            // Cmd+Shift+e: 居中对齐
            'Mod-Shift-e': ({ editor }) => {
                (editor.chain().focus() as any).setTextAlign('center').run()
                return true
            },

            // Cmd+Shift+r: 右对齐
            'Mod-Shift-r': ({ editor }) => {
                (editor.chain().focus() as any).setTextAlign('right').run()
                return true
            },

            // Cmd+Alt+1/2/3: 标题快捷键
            'Mod-Alt-1': ({ editor }) => {
                editor.chain().focus().toggleHeading({ level: 1 }).run()
                return true
            },
            'Mod-Alt-2': ({ editor }) => {
                editor.chain().focus().toggleHeading({ level: 2 }).run()
                return true
            },
            'Mod-Alt-3': ({ editor }) => {
                editor.chain().focus().toggleHeading({ level: 3 }).run()
                return true
            },

            // Cmd+Alt+0: 转为正文
            'Mod-Alt-0': ({ editor }) => {
                editor.chain().focus().setParagraph().run()
                return true
            },

            // Delete / Backspace 删除选中的块节点
            'Delete': ({ editor }) => {
                const { selection } = editor.state
                if (selection.node) {
                    const { tr } = editor.state
                    tr.delete(selection.from, selection.to)
                    editor.view.dispatch(tr)
                    return true
                }
                return false
            },

            // Cmd+Shift+J: 切换标题多级编号
            'Mod-Shift-j': () => {
                window.dispatchEvent(new CustomEvent('toggle-heading-numbered'))
                return true
            },

            // Cmd+K: 添加/编辑链接（通过自定义事件触发弹层）
            'Mod-k': ({ editor }) => {
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
