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
})
