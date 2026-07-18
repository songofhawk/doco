import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import CommandList from './CommandList'
import { Heading1, Heading2, Heading3, List, ListTodo, Quote, Code, Network, ImageIcon, FileCode, Table, Minus, Lightbulb, Sheet } from 'lucide-react'
import { uploadEditorImage } from '../imageUpload'

export const getSuggestionItems = ({ query, docId }: { query: string; docId?: string }) => {
    return [
        {
            title: '一级标题 (H1)',
            description: '大段落标题',
            keywords: ['h1', 'heading1', 'yjbt'],
            icon: Heading1,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
            },
        },
        {
            title: '二级标题 (H2)',
            description: '中等段落标题',
            keywords: ['h2', 'heading2', 'ejbt'],
            icon: Heading2,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
            },
        },
        {
            title: '三级标题 (H3)',
            description: '小段落标题',
            keywords: ['h3', 'heading3', 'sjbt'],
            icon: Heading3,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
            },
        },
        {
            title: '无序列表',
            description: '简单的项目列表',
            keywords: ['list', 'bullet', 'wxlb'],
            icon: List,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).toggleBulletList().run()
            },
        },
        {
            title: '任务列表',
            description: '带复选框的待办事项',
            keywords: ['task', 'todo', 'rwlb'],
            icon: ListTodo,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).toggleTaskList().run()
            },
        },
        {
            title: '引用',
            description: '捕获引述文本',
            keywords: ['quote', 'blockquote', 'yy'],
            icon: Quote,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setBlockquote().run()
            },
        },
        {
            title: '代码块',
            description: '代码片段',
            keywords: ['code', 'codeblock', 'dmk'],
            icon: Code,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setCodeBlock().run()
            },
        },
        {
            title: '图片',
            description: '上传或粘贴图片',
            keywords: ['image', 'picture', 'tp'],
            icon: ImageIcon,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).run()
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/*'
                let uploading = false
                input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (!file || uploading) return
                    uploading = true
                    try {
                        if (!docId) throw new Error('当前文档尚未就绪')
                        const image = await uploadEditorImage(file, docId)
                        editor.chain().focus().setImage({ src: image.src, attachmentId: image.id }).run()
                    } catch (err) {
                        console.error('Upload failed:', err)
                        alert(err instanceof Error ? err.message : '图片上传失败')
                    } finally {
                        uploading = false
                    }
                }
                input.click()
            },
        },
        {
            title: '流程图 (Mermaid)',
            description: '文本绘制图表',
            keywords: ['mermaid', 'flowchart', 'lct'],
            icon: Network,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).insertContent({
                    type: 'mermaidBlock',
                    attrs: {
                        code: 'graph TD\n  A[开始] --> B[核心处理]\n  B --> C[结束]'
                    }
                }).run()
            },
        },
        {
            title: 'UML 图 (PlantUML)',
            description: '文本绘制 UML 图表',
            keywords: ['plantuml', 'uml', 'sequence'],
            icon: FileCode,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).insertContent({
                    type: 'plantUMLBlock',
                    attrs: {
                        code: '@startuml\nAlice -> Bob: 你好\nBob --> Alice: 你好!\n@enduml'
                    }
                }).run()
            },
        },
        {
            title: '表格',
            description: '插入可编辑表格',
            keywords: ['table', 'bg'],
            icon: Table,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range)
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
            },
        },
        {
            title: '嵌入式电子表格',
            description: '插入支持公式、筛选和 CSV 的电子表格',
            keywords: ['spreadsheet', 'sheet', 'excel', 'dzbg'],
            icon: Sheet,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).insertContent({
                    type: 'spreadsheetBlock',
                }).run()
            },
        },
        {
            title: '高亮块',
            description: '带图标的彩色提示块',
            keywords: ['callout', 'highlight', 'glk'],
            icon: Lightbulb,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).insertContent({
                    type: 'calloutBlock',
                    content: [{ type: 'paragraph' }],
                }).run()
            },
        },
        {
            title: '分隔线',
            description: '插入水平分隔线',
            keywords: ['divider', 'hr', 'fgx'],
            icon: Minus,
            command: ({ editor, range }: any) => {
                editor.chain().focus().deleteRange(range).setHorizontalRule().run()
            },
        }
    ].filter(item => {
        const q = query.toLowerCase()
        return item.title.toLowerCase().includes(q) || item.keywords?.some((k: string) => k.startsWith(q))
    })
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
