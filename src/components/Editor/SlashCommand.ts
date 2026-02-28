import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'

export const SlashCommand = Extension.create({
    name: 'slashCommand',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                command: ({ editor, range, props }) => {
                    props.command({ editor, range })
                },
            } as Omit<SuggestionOptions, 'editor'>,
        }
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
                char: '、',
                pluginKey: new PluginKey('suggestionCN'),
            }),
        ]
    },
})
