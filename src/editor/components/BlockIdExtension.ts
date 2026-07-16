import { Extension, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ulid } from 'ulid'

export const BLOCK_TYPES = [
  'paragraph', 'heading', 'blockquote', 'horizontalRule', 'codeBlock',
  'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'image', 'table', 'tableRow', 'tableHeader', 'tableCell',
  'mermaidBlock', 'plantUMLBlock', 'calloutBlock', 'spreadsheetBlock',
]

export const DocoDocument = Node.create({ name: 'doc', topNode: true, content: 'block*' })

export const BlockIdExtension = Extension.create({
  name: 'docoBlockIds',

  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-block-id'),
          renderHTML: (attrs) => attrs.id ? { 'data-block-id': attrs.id } : {},
        },
      },
    }]
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('docoBlockIdMigration'),
      appendTransaction(transactions, _oldState, newState) {
        const seen = new Set<string>()
        const changes: Array<{ pos: number; attrs: Record<string, unknown> }> = []
        newState.doc.descendants((node, pos) => {
          if (!BLOCK_TYPES.includes(node.type.name)) return
          const id = node.attrs.id as string | null
          if (!id || seen.has(id)) {
            changes.push({ pos, attrs: { ...node.attrs, id: `block_${ulid()}` } })
          } else {
            seen.add(id)
          }
        })
        if (!changes.length) return null
        const tr = newState.tr
        for (const change of changes) {
          const node = tr.doc.nodeAt(change.pos)
          if (node) tr.setNodeMarkup(change.pos, undefined, change.attrs, node.marks)
        }
        // Yjs 会把原 transaction 与 appendTransaction 的最终文档状态一起同步。
        // 如果这里无条件排除历史，创建新块的用户操作也会整个丢失撤销记录。
        const followsUserEdit = transactions.some(transaction =>
          transaction.docChanged && transaction.getMeta('addToHistory') !== false)

        tr.setMeta('docoBlockIdMigration', true)
        if (!followsUserEdit) tr.setMeta('addToHistory', false)
        return tr
      },
    })]
  },
})
