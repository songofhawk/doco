import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import CommandList from './CommandList'
import { Heading1, Heading2, Heading3, List, ListTodo, Quote, Code, Network, ImageIcon } from 'lucide-react'

export const getSuggestionItems = ({ query }: { query: string }) => {
    return [
        {
            title: '一级标题 (H1)',
            description: '大段落标题',
            icon: Heading1,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
            },
        },
        {
            title: '二级标题 (H2)',
            description: '中等段落标题',
            icon: Heading2,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
            },
        },
        {
            title: '三级标题 (H3)',
            description: '小段落标题',
            icon: Heading3,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
            },
        },
        {
            title: '无序列表',
            description: '简单的项目列表',
            icon: List,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).toggleBulletList().run()
            },
        },
        {
            title: '任务列表',
            description: '带复选框的待办事项',
            icon: ListTodo,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).toggleTaskList().run()
            },
        },
        {
            title: '引用',
            description: '捕获引述文本',
            icon: Quote,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setBlockquote().run()
            },
        },
        {
            title: '代码块',
            description: '代码片段',
            icon: Code,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setCodeBlock().run()
            },
        },
        {
            title: '图片',
            description: '上传或粘贴图片',
            icon: ImageIcon,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).run()
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/*'
                input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => {
                        editor.chain().focus().setImage({ src: reader.result as string }).run()
                    }
                    reader.readAsDataURL(file)
                }
                input.click()
            },
        },
        {
            title: '流程图 (Mermaid)',
            description: '文本绘制图表',
            icon: Network,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).insertContent({ type: 'mermaidBlock' }).run()
            },
        }
    ].filter(item => item.title.toLowerCase().startsWith(query.toLowerCase()) || item.title.includes(query))
}

export const renderItems = () => {
    let component: any
    let popup: any

    return {
        onStart: (props: any) => {
            component = new ReactRenderer(CommandList, {
                props,
                editor: props.editor,
            })

            if (!props.clientRect) {
                return
            }

            popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
            })
        },

        onUpdate(props: any) {
            component.updateProps(props)

            if (!props.clientRect) {
                return
            }

            popup[0].setProps({
                getReferenceClientRect: props.clientRect,
            })
        },

        onKeyDown(props: any) {
            if (props.event.key === 'Escape') {
                popup[0].hide()
                return true
            }

            return component.ref?.onKeyDown(props)
        },

        onExit() {
            popup[0].destroy()
            component.destroy()
        },
    }
}
