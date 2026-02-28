import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PlantUMLComponent from './PlantUMLComponent'

export const PlantUMLBlock = Node.create({
    name: 'plantUMLBlock',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            code: {
                default: '@startuml\nAlice -> Bob: 你好\nBob --> Alice: 你好!\n@enduml',
            },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="plantuml"]',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'plantuml' })]
    },

    addNodeView() {
        return ReactNodeViewRenderer(PlantUMLComponent)
    },
})
