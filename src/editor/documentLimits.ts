import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

function positiveInteger(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const DOCUMENT_CHARACTER_LIMIT = positiveInteger(import.meta.env.VITE_MAX_DOCUMENT_CHARACTERS, 100_000)
export const YDOC_SNAPSHOT_BYTE_LIMIT = positiveInteger(import.meta.env.VITE_MAX_YDOC_SNAPSHOT_BYTES, 5 * 1024 * 1024)

export function countSpreadsheetVisibleCharacters(cells: Record<string, unknown>) {
    return Array.from(Object.values(cells).join('').replace(/\s/gu, '')).length
}

export function countVisibleCharacters(doc: ProseMirrorNode) {
    const parts: string[] = []
    doc.descendants(node => {
        if (node.isText && node.text) parts.push(node.text)
        if ((node.type.name === 'mermaidBlock' || node.type.name === 'plantUMLBlock') && typeof node.attrs.code === 'string') {
            parts.push(node.attrs.code)
        }
        if (node.type.name === 'spreadsheetBlock' && node.attrs.data?.cells && typeof node.attrs.data.cells === 'object') {
            parts.push(Object.values(node.attrs.data.cells).join(''))
        }
    })
    return Array.from(parts.join('').replace(/\s/gu, '')).length
}

export const DocumentLimitExtension = Extension.create<{
    limit: number
    onLimit: (limit: number) => void
}>({
    name: 'documentLimit',

    addOptions() {
        return {
            limit: DOCUMENT_CHARACTER_LIMIT,
            onLimit: () => undefined,
        }
    },

    addProseMirrorPlugins() {
        return [new Plugin({
            key: new PluginKey('documentLimit'),
            filterTransaction: (transaction, state) => {
                if (!transaction.docChanged) return true
                const before = countVisibleCharacters(state.doc)
                const after = countVisibleCharacters(transaction.doc)
                if (after <= this.options.limit || after < before) return true
                queueMicrotask(() => this.options.onLimit(this.options.limit))
                return false
            },
        })]
    },
})
