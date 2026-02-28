import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CalloutComponent } from './CalloutComponent'

export const CalloutBlock = Node.create({
    name: 'calloutBlock',
    group: 'block',
    content: 'block+',

    addAttributes() {
        return {
            emoji: { default: '💡' },
            color: { default: 'blue' },
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
})
