import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PlantUMLComponent from './PlantUMLComponent'
import type { PlantUMLRenderer } from '../plantUML'

export type PlantUMLBlockOptions = {
    renderer: PlantUMLRenderer | null
}

type MarkdownState = {
    write: (value: string) => void
    text: (value: string, escape?: boolean) => void
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

export const PlantUMLBlock = Node.create<PlantUMLBlockOptions>({
    name: 'plantUMLBlock',
    group: 'block',
    atom: true,

    addOptions() {
        return { renderer: null }
    },

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
                serialize(state: MarkdownState, node: { attrs: { code: string } }) {
                    state.write('```plantuml\n')
                    state.text(node.attrs.code, false)
                    state.ensureNewLine()
                    state.write('```')
                    state.closeBlock(node)
                },
                parse: {
                    setup(markdownit: MarkdownItLike) {
                        const fence = markdownit.renderer.rules.fence
                        markdownit.renderer.rules.fence = (tokens, idx, options, env, self) => {
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
