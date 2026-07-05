import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MermaidComponent from './MermaidComponent'

export const MermaidBlock = Node.create({
    name: 'mermaidBlock',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            code: {
                default: 'graph TD\n  A[开始] --> B[核心处理]\n  B --> C[结束]',
                parseHTML: element => element.getAttribute('data-code'),
                renderHTML: attributes => {
                    return {
                        'data-code': attributes.code,
                    }
                },
            },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="mermaid"]',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })]
    },

    addNodeView() {
        return ReactNodeViewRenderer(MermaidComponent)
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    state.write('```mermaid\n')
                    state.text(node.attrs.code, false)
                    state.ensureNewLine()
                    state.write('```')
                    state.closeBlock(node)
                },
                parse: {
                    setup(markdownit: any) {
                        const fence = markdownit.renderer.rules.fence
                        markdownit.renderer.rules.fence = (tokens: any, idx: number, options: any, env: any, self: any) => {
                            const token = tokens[idx]
                            if (token.info.trim() === 'mermaid') {
                                return `<div data-type="mermaid" data-code="${markdownit.utils.escapeHtml(token.content.replace(/\n$/, ''))}"></div>`
                            }
                            return fence(tokens, idx, options, env, self)
                        }
                    },
                },
            },
        }
    },
})
