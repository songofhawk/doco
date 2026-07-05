import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CalloutComponent } from './CalloutComponent'

export const CalloutBlock = Node.create({
    name: 'calloutBlock',
    group: 'block',
    content: 'block+',

    addAttributes() {
        return {
            emoji: {
                default: '💡',
                parseHTML: element => element.getAttribute('data-emoji'),
                renderHTML: attributes => ({
                    'data-emoji': attributes.emoji,
                }),
            },
            color: {
                default: 'blue',
                parseHTML: element => element.getAttribute('data-color'),
                renderHTML: attributes => ({
                    'data-color': attributes.color,
                }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-type="callout"]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
    },

    addNodeView() {
        return ReactNodeViewRenderer(CalloutComponent)
    },

    addStorage() {
        return {
            markdown: {
                // 导出为带 emoji 的引用块（Markdown 无 callout 语法，导入时会变为普通引用）
                serialize(state: any, node: any) {
                    state.wrapBlock('> ', `> ${node.attrs.emoji} `, node, () => state.renderContent(node))
                },
            },
        }
    },
})
