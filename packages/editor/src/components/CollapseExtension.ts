import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const collapsePluginKey = new PluginKey('collapse')

export interface CollapseOptions {
    onCollapseChange?: (positions: number[]) => void
}

export const CollapseExtension = Extension.create<CollapseOptions>({
    name: 'collapse',

    addOptions() {
        return {
            onCollapseChange: undefined,
        }
    },

    addStorage() {
        return { collapsed: new Set<number>() }
    },

    addCommands(): any {
        return {
            toggleCollapse: (pos: number) => ({ tr, dispatch }: any) => {
                if (dispatch) {
                    const set = this.storage.collapsed as Set<number>
                    if (set.has(pos)) set.delete(pos)
                    else set.add(pos)
                    tr.setMeta(collapsePluginKey, true)
                    dispatch(tr)
                    this.options.onCollapseChange?.([...this.storage.collapsed])
                }
                return true
            },
            setCollapsed: (positions: number[]) => ({ tr, dispatch }: any) => {
                if (dispatch) {
                    this.storage.collapsed = new Set(positions)
                    tr.setMeta(collapsePluginKey, true)
                    dispatch(tr)
                }
                return true
            },
        }
    },

    addProseMirrorPlugins() {
        const storage = this.storage
        const options = this.options

        return [
            new Plugin({
                key: collapsePluginKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply: (tr) => {
                        if (tr.docChanged) {
                            const newCollapsed = new Set<number>()
                            for (const oldPos of storage.collapsed) {
                                const mapped = tr.mapping.map(oldPos, 1)
                                if (mapped >= 0 && mapped < tr.doc.content.size && tr.doc.nodeAt(mapped)) {
                                    newCollapsed.add(mapped)
                                }
                            }
                            storage.collapsed = newCollapsed
                        }
                        const decos: Decoration[] = []
                        for (const pos of storage.collapsed) {
                            const node = tr.doc.nodeAt(pos)
                            if (node) {
                                decos.push(Decoration.node(pos, pos + node.nodeSize, {
                                    class: 'doco-collapsed',
                                }))
                            }
                        }
                        return DecorationSet.create(tr.doc, decos)
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state)
                    },
                },
                view(editorView) {
                    const onClick = (e: MouseEvent) => {
                        const target = (e.target as HTMLElement).closest('.doco-collapsed')
                        if (!target) return
                        let el = target as HTMLElement
                        while (el && el.parentElement !== editorView.dom) {
                            el = el.parentElement!
                        }
                        if (!el) return
                        const domPos = editorView.posAtDOM(el, 0)
                        const $pos = editorView.state.doc.resolve(domPos)
                        const depth = Math.max(1, $pos.depth)
                        const nodePos = $pos.before(depth)
                        if (storage.collapsed.has(nodePos)) {
                            e.preventDefault()
                            e.stopPropagation()
                            storage.collapsed.delete(nodePos)
                            const tr = editorView.state.tr.setMeta(collapsePluginKey, true)
                            editorView.dispatch(tr)
                            options.onCollapseChange?.([...storage.collapsed])
                        }
                    }
                    editorView.dom.addEventListener('click', onClick, true)
                    return {
                        destroy() {
                            editorView.dom.removeEventListener('click', onClick, true)
                        },
                    }
                },
            }),
        ]
    },
})
