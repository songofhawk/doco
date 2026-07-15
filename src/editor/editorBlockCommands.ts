import type { Editor } from '@tiptap/react'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'

export type ConvertibleBlock =
    | 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'taskList'
    | 'blockquote' | 'codeBlock' | 'calloutBlock' | 'horizontalRule'

export interface TopLevelSelection {
    from: number
    to: number
    count: number
    firstPos: number
}

export function getTopLevelSelection(editor: Editor): TopLevelSelection | null {
    const { doc, selection } = editor.state
    let firstPos = -1
    let from = -1
    let to = -1
    let count = 0

    doc.forEach((node, pos) => {
        const nodeEnd = pos + node.nodeSize
        const intersects = nodeEnd > selection.from && pos < selection.to
            || selection.empty && pos <= selection.from && nodeEnd >= selection.from
        if (!intersects) return
        if (firstPos < 0) {
            firstPos = pos
            from = pos
        }
        to = nodeEnd
        count += 1
    })

    return firstPos < 0 ? null : { from, to, count, firstPos }
}

function selectedTopLevelNodes(editor: Editor, range: TopLevelSelection): ProseMirrorNode[] {
    const nodes: ProseMirrorNode[] = []
    editor.state.doc.slice(range.from, range.to).content.forEach(node => nodes.push(node))
    return nodes
}

function collectTextBlocks(node: ProseMirrorNode, result: ProseMirrorNode[]) {
    if (node.isTextblock) {
        result.push(node)
        return
    }
    node.forEach(child => collectTextBlocks(child, result))
}

/**
 * 转换当前选区覆盖的顶层块：
 * - 正文/标题逐个转换，保留每行边界和行内 marks。
 * - 列表把每个文本块变成独立列表项。
 * - 引用/高亮块包裹完整选区，保留内部块结构。
 * - 代码块按换行合并文本。
 */
export function convertSelectedBlocks(editor: Editor, type: ConvertibleBlock, level?: number): boolean {
    const range = getTopLevelSelection(editor)
    if (!range || (type === 'horizontalRule' && range.count !== 1)) return false

    const selectedNodes = selectedTopLevelNodes(editor, range)
    if (!selectedNodes.length) return false
    const textBlocks: ProseMirrorNode[] = []
    selectedNodes.forEach(node => collectTextBlocks(node, textBlocks))

    const { tr, schema } = editor.state
    let replacement: Fragment

    switch (type) {
        case 'paragraph': {
            const paragraphs = textBlocks.map(block => schema.nodes.paragraph.create(null, block.content))
            replacement = Fragment.fromArray(paragraphs.length ? paragraphs : [schema.nodes.paragraph.create()])
            break
        }
        case 'heading': {
            const headings = textBlocks.map(block =>
                schema.nodes.heading.create({ level: level || 1 }, block.content))
            replacement = Fragment.fromArray(headings.length ? headings : [schema.nodes.heading.create({ level: level || 1 })])
            break
        }
        case 'bulletList': {
            const items = textBlocks.map(block =>
                schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, block.content)))
            const content = items.length ? items : [schema.nodes.listItem.create(null, schema.nodes.paragraph.create())]
            replacement = Fragment.from(schema.nodes.bulletList.create(null, content))
            break
        }
        case 'orderedList': {
            const items = textBlocks.map(block =>
                schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, block.content)))
            const content = items.length ? items : [schema.nodes.listItem.create(null, schema.nodes.paragraph.create())]
            replacement = Fragment.from(schema.nodes.orderedList.create(null, content))
            break
        }
        case 'taskList': {
            const items = textBlocks.map(block =>
                schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create(null, block.content)))
            const content = items.length
                ? items
                : [schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create())]
            replacement = Fragment.from(schema.nodes.taskList.create(null, content))
            break
        }
        case 'blockquote':
            replacement = Fragment.from(schema.nodes.blockquote.create(null, selectedNodes))
            break
        case 'codeBlock': {
            const textContent = textBlocks.map(block => block.textContent).join('\n')
            replacement = Fragment.from(schema.nodes.codeBlock.create(
                null,
                textContent ? schema.text(textContent) : null,
            ))
            break
        }
        case 'calloutBlock':
            replacement = Fragment.from(schema.nodes.calloutBlock.create(null, selectedNodes))
            break
        case 'horizontalRule':
            replacement = Fragment.from(schema.nodes.horizontalRule.create())
            break
    }

    tr.replaceWith(range.from, range.to, replacement)
    editor.view.dispatch(tr)
    if (type !== 'horizontalRule') editor.commands.setTextSelection(range.from + 1)
    editor.commands.focus()
    return true
}

export function duplicateSelectedBlocks(editor: Editor): boolean {
    const range = getTopLevelSelection(editor)
    if (!range) return false
    const content = editor.state.doc.slice(range.from, range.to).content
    editor.view.dispatch(editor.state.tr.insert(range.to, content))
    editor.commands.focus()
    return true
}

export function moveSelectedBlocks(editor: Editor, direction: 'up' | 'down'): boolean {
    const range = getTopLevelSelection(editor)
    if (!range) return false
    const selected = editor.state.doc.slice(range.from, range.to).content
    const { doc, tr } = editor.state

    if (direction === 'up') {
        if (range.from === 0) return false
        const previous = doc.resolve(range.from).nodeBefore
        if (!previous) return false
        const previousPos = range.from - previous.nodeSize
        tr.replaceWith(previousPos, range.to, selected.append(Fragment.from(previous)))
    } else {
        const next = doc.nodeAt(range.to)
        if (!next) return false
        tr.replaceWith(range.from, range.to + next.nodeSize, Fragment.from(next).append(selected))
    }

    editor.view.dispatch(tr)
    editor.commands.focus()
    return true
}

export function insertParagraphBelow(editor: Editor): boolean {
    const range = getTopLevelSelection(editor)
    if (!range) return false
    editor.chain().insertContentAt(range.to, { type: 'paragraph' }).focus(range.to + 1).run()
    return true
}

export function toggleCurrentBlockCollapse(editor: Editor): boolean {
    const range = getTopLevelSelection(editor)
    if (!range || range.count !== 1) return false
    const commands = editor.commands as unknown as { toggleCollapse: (pos: number) => boolean }
    commands.toggleCollapse(range.firstPos)
    editor.commands.focus()
    return true
}
