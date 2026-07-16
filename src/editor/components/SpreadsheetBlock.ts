import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import SpreadsheetComponent from './SpreadsheetComponent'
import { cellKey, createSpreadsheetData, normalizeSpreadsheetData, parseDelimited, type SpreadsheetData } from './spreadsheetEngine'

type MarkdownState = {
    write: (value: string) => void
    ensureNewLine: () => void
    closeBlock: (node: unknown) => void
}

type MarkdownToken = { info: string; content: string }
type FenceRenderer = (
    tokens: MarkdownToken[],
    index: number,
    options: unknown,
    environment: unknown,
    self: unknown,
) => string
type MarkdownItLike = {
    renderer: { rules: { fence: FenceRenderer } }
    utils: { escapeHtml: (value: string) => string }
}

const encodeData = (data: SpreadsheetData) => encodeURIComponent(JSON.stringify(data))

const decodeData = (value: string | null) => {
    if (!value) return createSpreadsheetData()
    try {
        return normalizeSpreadsheetData(JSON.parse(decodeURIComponent(value)))
    } catch {
        return createSpreadsheetData()
    }
}

export const SpreadsheetBlock = Node.create({
    name: 'spreadsheetBlock',
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
        return {
            data: {
                default: createSpreadsheetData(),
                parseHTML: element => decodeData(element.getAttribute('data-sheet')),
                renderHTML: attributes => ({ 'data-sheet': encodeData(normalizeSpreadsheetData(attributes.data)) }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-type="spreadsheet"]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'spreadsheet' })]
    },

    addNodeView() {
        return ReactNodeViewRenderer(SpreadsheetComponent)
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: MarkdownState, node: { attrs: { data: unknown } }) {
                    const data = normalizeSpreadsheetData(node.attrs.data)
                    state.write('```csv\n')
                    for (let row = 0; row < data.rows; row += 1) {
                        const values = []
                        for (let col = 0; col < data.cols; col += 1) {
                            let index = col + 1
                            let name = ''
                            while (index > 0) {
                                index -= 1
                                name = String.fromCharCode(65 + (index % 26)) + name
                                index = Math.floor(index / 26)
                            }
                            const value = data.cells[`${name}${row + 1}`] || ''
                            values.push(/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
                        }
                        state.write(values.join(','))
                        state.ensureNewLine()
                    }
                    state.write('```')
                    state.closeBlock(node)
                },
                parse: {
                    setup(markdownit: MarkdownItLike) {
                        const fence = markdownit.renderer.rules.fence
                        markdownit.renderer.rules.fence = (tokens, idx, options, env, self) => {
                            const token = tokens[idx]
                            if (token.info.trim().toLowerCase() === 'csv') {
                                const rows = parseDelimited(token.content.replace(/\n$/, ''))
                                const data = createSpreadsheetData(
                                    Math.max(10, rows.length),
                                    Math.max(6, ...rows.map(row => row.length)),
                                )
                                rows.forEach((row, rowIndex) => row.forEach((value, colIndex) => {
                                    if (value) data.cells[cellKey(rowIndex, colIndex)] = value
                                }))
                                return `<div data-type="spreadsheet" data-sheet="${markdownit.utils.escapeHtml(encodeData(data))}"></div>`
                            }
                            return fence(tokens, idx, options, env, self)
                        }
                    },
                },
            },
        }
    },
})
