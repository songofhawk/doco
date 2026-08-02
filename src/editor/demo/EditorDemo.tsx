import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { Check, Clipboard, CloudOff, Database, FileJson, RotateCcw } from 'lucide-react'
import {
  DocoTextEditor,
  renderPlantUMLWithPublicServer,
  type DocoTextEditorChange,
  type DocoTextEditorRef,
} from '../standalone'
import { readBrowserDocument, writeBrowserDocument } from './browserStorage'

const paragraph = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  attrs,
  content: [{ type: 'text', text }],
})

const listItem = (text: string): JSONContent => ({
  type: 'listItem',
  content: [paragraph(text)],
})

const taskItem = (text: string, checked = false): JSONContent => ({
  type: 'taskItem',
  attrs: { checked },
  content: [paragraph(text)],
})

const tableCell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({
  type,
  content: [paragraph(text)],
})

const INITIAL_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'DocoTextEditor 完整样式示例' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '这是一份只保存在当前浏览器里的 ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'DocoTextEditor' },
        { type: 'text', text: ' 文档，集中展示组件支持的文字、列表、媒体和结构化内容。' },
      ],
    },
    {
      type: 'blockquote',
      content: [paragraph('正文不依赖文档后端，编辑结果会自动写入 IndexedDB；刷新页面后仍可恢复。')],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '文字层级与行内样式' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '三级标题适合较小的内容分组' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '支持 ' },
        { type: 'text', marks: [{ type: 'bold' }], text: '粗体' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'italic' }], text: '斜体' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'underline' }], text: '下划线' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'strike' }], text: '删除线' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'code' }], text: 'inline code' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'highlight' }], text: '高亮文字' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'textStyle', attrs: { color: '#c96442' } }], text: '彩色文字' },
        { type: 'text', text: '和' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://tiptap.dev', target: '_blank', rel: 'noopener noreferrer' } }],
          text: '链接',
        },
        { type: 'text', text: '。' },
      ],
    },
    paragraph('这是一段普通的左对齐正文。', { textAlign: 'left' }),
    paragraph('这一段使用居中对齐，用来展示段落级排版。', { textAlign: 'center' }),
    paragraph('这一段使用右对齐，三种段落对齐方式都可以直接编辑。', { textAlign: 'right' }),
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '列表' }],
    },
    {
      type: 'bulletList',
      content: [
        listItem('无序列表适合并列信息'),
        listItem('输入 / 可以随时打开插入菜单'),
      ],
    },
    {
      type: 'orderedList',
      content: [
        listItem('先组织文档结构'),
        listItem('再补充内容与样式'),
        listItem('最后刷新检查浏览器持久化'),
      ],
    },
    {
      type: 'taskList',
      content: [
        taskItem('已完成：加载纯前端编辑器', true),
        taskItem('待处理：修改这份示例文档'),
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '提示块与表格' }],
    },
    {
      type: 'calloutBlock',
      attrs: { emoji: '🔥', color: 'orange' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: '高亮块：' },
            { type: 'text', text: '点击左侧图标可以切换提示、警告、成功、备注等样式。' },
          ],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            tableCell('tableHeader', '能力'),
            tableCell('tableHeader', '编辑方式'),
            tableCell('tableHeader', '保存格式'),
          ],
        },
        {
          type: 'tableRow',
          content: [
            tableCell('tableCell', '普通文本'),
            tableCell('tableCell', '直接输入'),
            tableCell('tableCell', 'JSON / HTML / Markdown'),
          ],
        },
        {
          type: 'tableRow',
          content: [
            tableCell('tableCell', '自定义节点'),
            tableCell('tableCell', 'Slash 菜单'),
            tableCell('tableCell', 'Tiptap JSON'),
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '代码与图表' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{
        type: 'text',
        text: "const editor = editorRef.current\nconst markdown = editor?.getContent('markdown')\nconsole.log(markdown)",
      }],
    },
    {
      type: 'mermaidBlock',
      attrs: {
        code: 'flowchart LR\n  A[浏览器编辑] --> B[IndexedDB 保存]\n  B --> C[刷新后恢复]',
      },
    },
    {
      type: 'plantUMLBlock',
      attrs: {
        code: '@startuml\nactor 用户\n用户 -> 编辑器: 编写文档\n编辑器 -> IndexedDB: 自动保存\nIndexedDB --> 编辑器: 刷新后恢复\n@enduml',
      },
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '图片与电子表格' }],
    },
    {
      type: 'image',
      attrs: {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 260'%3E%3Crect width='800' height='260' rx='28' fill='%23f3e9e4'/%3E%3Cpath d='M80 175 C180 55 285 220 395 105 S610 50 720 150' fill='none' stroke='%23c96442' stroke-width='12' stroke-linecap='round'/%3E%3Ccircle cx='80' cy='175' r='18' fill='%23141413'/%3E%3Ccircle cx='720' cy='150' r='18' fill='%23141413'/%3E%3Ctext x='400' y='225' text-anchor='middle' font-family='Georgia,serif' font-size='28' fill='%235e5d59'%3EDocoTextEditor · browser only%3C/text%3E%3C/svg%3E",
        alt: 'DocoTextEditor 示例插图',
        title: '浏览器中的纯前端编辑器',
        width: 720,
        align: 'center',
      },
    },
    {
      type: 'spreadsheetBlock',
      attrs: {
        data: {
          version: 1,
          rows: 10,
          cols: 6,
          cells: {
            A1: '项目', B1: '数量', C1: '单价', D1: '小计',
            A2: '编辑器组件', B2: '2', C2: '120', D2: '=B2*C2',
            A3: '导入适配器', B3: '1', C3: '80', D3: '=B3*C3',
            A4: '合计', D4: '=SUM(D2:D3)',
          },
          styles: {
            A1: { bold: true, background: '#f3e9e4' },
            B1: { bold: true, background: '#f3e9e4' },
            C1: { bold: true, background: '#f3e9e4' },
            D1: { bold: true, background: '#f3e9e4' },
            B2: { format: 'number' }, C2: { format: 'currency' }, D2: { format: 'currency' },
            B3: { format: 'number' }, C3: { format: 'currency' }, D3: { format: 'currency' },
            A4: { bold: true }, D4: { bold: true, format: 'currency' },
          },
          colWidths: { A: 160, B: 90, C: 110, D: 120 },
          merges: [],
          frozenRows: 1,
          frozenCols: 0,
          filters: {},
        },
      },
    },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'italic' }], text: '现在轮到你了：修改内容、插入新块，然后刷新页面看看。' },
      ],
    },
  ],
}

const LEGACY_EXAMPLE_MARKERS = [
  '一份只属于这个浏览器的文档',
  '输入 / 打开命令菜单',
  '插入表格、Callout 或 Mermaid 图表',
]

function isLegacyExampleDocument(json: JSONContent) {
  const serialized = JSON.stringify(json)
  return LEGACY_EXAMPLE_MARKERS.every(marker => serialized.includes(marker))
}

type SaveState = 'loading' | 'saved' | 'saving' | 'error'
type PreviewMode = 'markdown' | 'json'

function timeLabel(isoDate: string | null) {
  if (!isoDate) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(isoDate))
}

export function EditorDemo() {
  const editorRef = useRef<DocoTextEditorRef>(null)
  const saveTimerRef = useRef<number | null>(null)
  const [document, setDocument] = useState<JSONContent>(INITIAL_DOCUMENT)
  const [previewContent, setPreviewContent] = useState('编辑器就绪后，这里会显示所选格式。')
  const [characterCount, setCharacterCount] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('markdown')
  const [copied, setCopied] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true

    void readBrowserDocument()
      .then(async (stored) => {
        if (!active) return
        if (stored) {
          if (isLegacyExampleDocument(stored.json)) {
            setDocument(INITIAL_DOCUMENT)
            const upgraded = await writeBrowserDocument(INITIAL_DOCUMENT)
            if (!active) return
            setSavedAt(upgraded.updatedAt)
          } else {
            setDocument(stored.json)
            setSavedAt(stored.updatedAt)
          }
        }
        setSaveState('saved')
      })
      .catch((error: unknown) => {
        if (!active) return
        setSaveState('error')
        setErrorMessage(error instanceof Error ? error.message : '浏览器存储不可用')
      })
      .finally(() => {
        if (active) setReady(true)
      })

    return () => {
      active = false
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  const save = useCallback(async (json: JSONContent) => {
    try {
      const stored = await writeBrowserDocument(json)
      setSavedAt(stored.updatedAt)
      setSaveState('saved')
      setErrorMessage('')
    } catch (error) {
      setSaveState('error')
      setErrorMessage(error instanceof Error ? error.message : '保存失败')
    }
  }, [])

  const contentForPreview = useCallback((mode: PreviewMode) => {
    const editor = editorRef.current
    if (!editor) return ''
    if (mode === 'json') {
      return JSON.stringify(editor.getContent('tiptap-json'), null, 2)
    }
    return editor.getContent('markdown')
  }, [])

  const handleChange = useCallback((change: DocoTextEditorChange) => {
    if (change.steps.length === 0) return
    const editor = editorRef.current
    const json = editor?.getContent('tiptap-json')
    if (!editor || !json) return

    setPreviewContent(contentForPreview(previewMode))
    setCharacterCount(editor.getContent('text').length)
    setSaveState('saving')

    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void save(json)
    }, 500)
  }, [contentForPreview, previewMode, save])

  const refreshPreview = useCallback((mode = previewMode) => {
    const editor = editorRef.current
    if (!editor) return
    setPreviewContent(contentForPreview(mode))
    setCharacterCount(editor.getContent('text').length)
  }, [contentForPreview, previewMode])

  const selectPreviewMode = useCallback((mode: PreviewMode) => {
    setPreviewMode(mode)
    refreshPreview(mode)
  }, [refreshPreview])

  const resetDocument = useCallback(() => {
    if (!window.confirm('确定加载完整示例吗？当前浏览器里的编辑内容会被覆盖。')) return
    setDocument(INITIAL_DOCUMENT)
    editorRef.current?.setContent(INITIAL_DOCUMENT, 'tiptap-json')
    setSaveState('saving')
    void save(INITIAL_DOCUMENT)
    window.setTimeout(refreshPreview, 0)
  }, [refreshPreview, save])

  const copyPreview = useCallback(async () => {
    const content = contentForPreview(previewMode)
    await navigator.clipboard.writeText(content)
    setPreviewContent(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [contentForPreview, previewMode])

  return (
    <main className="editor-demo">
      <div className="editor-demo__shell">
        <header className="editor-demo__header">
          <div>
            <div className="editor-demo__eyebrow">Standalone component playground</div>
            <h1>DocoTextEditor，独立运行。</h1>
            <p>
              这个页面直接引用纯前端入口。没有账号、没有文档 API，也没有协同服务；刷新页面后，
              内容从当前浏览器恢复。
            </p>
          </div>

          <div className="editor-demo__facts" aria-label="Demo 运行方式">
            <span><CloudOff size={15} /> 无自有后端</span>
            <span><Database size={15} /> IndexedDB</span>
            <span><Check size={15} /> 自动保存</span>
          </div>
        </header>

        <div className="editor-demo__toolbar">
          <div className={`editor-demo__save-state is-${saveState}`} role="status" aria-live="polite">
            <span className="editor-demo__status-dot" />
            {saveState === 'loading' && '正在读取浏览器文档…'}
            {saveState === 'saving' && '正在保存到浏览器…'}
            {saveState === 'saved' && (savedAt ? `已保存于 ${timeLabel(savedAt)}` : '可以开始编辑')}
            {saveState === 'error' && (errorMessage || '浏览器存储不可用')}
          </div>
          <button type="button" className="editor-demo__button" onClick={resetDocument}>
            <RotateCcw size={16} /> 加载完整示例
          </button>
        </div>

        <section className="editor-demo__workspace">
          <div className="editor-demo__editor-card">
            <div className="editor-demo__card-heading">
              <div>
                <span>DOCUMENT</span>
                <h2>浏览器里的草稿</h2>
              </div>
              <span>{characterCount} 字</span>
            </div>

            {ready ? (
              <DocoTextEditor
                ref={editorRef}
                value={document}
                format="tiptap-json"
                onChange={handleChange}
                onBlur={refreshPreview}
                onReady={() => window.setTimeout(refreshPreview, 0)}
                onError={(error) => {
                  setSaveState('error')
                  setErrorMessage(error.message)
                }}
                renderPlantUML={renderPlantUMLWithPublicServer}
                placeholder="输入 / 唤起菜单，或直接开始写作…"
                className="editor-demo__editor"
              />
            ) : (
              <div className="editor-demo__loading">正在打开浏览器文档…</div>
            )}
          </div>

          <aside className="editor-demo__preview">
            <div className="editor-demo__preview-header">
              <div className="editor-demo__tabs" role="tablist" aria-label="内容格式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === 'markdown'}
                  onClick={() => selectPreviewMode('markdown')}
                >
                  Markdown
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === 'json'}
                  onClick={() => selectPreviewMode('json')}
                >
                  JSON
                </button>
              </div>
              <button
                type="button"
                className="editor-demo__icon-button"
                onClick={() => void copyPreview()}
                aria-label="复制当前格式"
                title="复制当前格式"
              >
                {copied ? <Check size={16} /> : <Clipboard size={16} />}
              </button>
            </div>
            <div className="editor-demo__preview-label">
              <FileJson size={15} /> 宿主页面可取得的内容
            </div>
            <pre>{previewContent}</pre>
            <p className="editor-demo__preview-note">
              ClickUp 适配器以后可以读取这里的 Markdown 或 JSON；编辑器核心无需知道目标后端。
            </p>
          </aside>
        </section>
      </div>
    </main>
  )
}
