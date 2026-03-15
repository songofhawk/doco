import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import type { Attrs, Node as ProseMirrorNode } from '@tiptap/pm/model'

const listNormalizationPluginKey = new PluginKey('list-normalization')

const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList'])

function shallowEqualAttrs(left: Attrs, right: Attrs) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)

    if (leftKeys.length !== rightKeys.length) return false

    return leftKeys.every(key => left[key] === right[key])
}

function findAdjacentListBoundary(doc: ProseMirrorNode) {
    let boundary: number | null = null

    doc.descendants((node, pos, parent) => {
        if (boundary !== null) return false
        if (!parent || !LIST_NODE_NAMES.has(node.type.name)) return true

        const $pos = doc.resolve(pos)
        const index = $pos.index($pos.depth)
        if (index >= parent.childCount - 1) return false

        const nextSibling = parent.child(index + 1)
        if (nextSibling.type !== node.type) return false
        if (!shallowEqualAttrs(node.attrs, nextSibling.attrs)) return false

        const joinPos = pos + node.nodeSize
        if (!canJoin(doc, joinPos)) return false

        boundary = joinPos
        return false
    })

    return boundary
}

export const ListNormalizationExtension = Extension.create({
    name: 'listNormalization',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: listNormalizationPluginKey,
                appendTransaction(transactions, _oldState, newState) {
                    if (!transactions.some(transaction => transaction.docChanged)) return null
                    if (transactions.some(transaction => transaction.getMeta(listNormalizationPluginKey))) return null

                    let tr = newState.tr
                    let changed = false

                    while (true) {
                        const joinPos = findAdjacentListBoundary(tr.doc)
                        if (joinPos === null) break

                        tr = tr.join(joinPos)
                        changed = true
                    }

                    if (!changed) return null

                    tr.setMeta(listNormalizationPluginKey, true)
                    return tr
                },
            }),
        ]
    },
})
