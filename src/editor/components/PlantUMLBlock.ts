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
                parseHTML: element => element.getAttribute('data-code'),
                renderHTML: attributes => ({
                    'data-code': attributes.code,
                }),
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

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    state.write('```plantuml\n')
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
                            if (token.info.trim() === 'plantuml') {
                                return `<div data-type="plantuml" data-code="${markdownit.utils.escapeHtml(token.content.replace(/\n$/, ''))}"></div>`
                            }
                            return fence(tokens, idx, options, env, self)
                        }
                    },
                },
            },
        }
    },
})
