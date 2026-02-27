import React, { useRef, useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import { Editor } from './components/Editor'
import { Sidebar } from './components/Sidebar'
import { PanelLeft, PanelLeftClose, FileText, Upload, Download, ChevronDown } from 'lucide-react'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-5">
      <FileText size={28} className="text-gray-300" />
    </div>
    <p className="text-base font-medium text-gray-500 mb-2">选择或创建一个文档</p>
    <p className="text-sm text-gray-400">从左侧知识库中打开文档，或新建一个开始写作</p>
    <div className="mt-8 flex flex-col gap-2 text-xs text-gray-400">
      <div className="flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">/</kbd>
        <span>唤起命令菜单</span>
      </div>
      <div className="flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">Markdown</kbd>
        <span>支持 Markdown 语法</span>
      </div>
    </div>
  </div>
)

const EditorPage = ({ exportRef }: { exportRef: any }) => {
  const { id } = useParams<{ id: string }>()
  if (!id) return <EmptyState />
  return <Editor ref={exportRef} docId={id} key={id} />
}

const COLLAPSE_BREAKPOINT = 768

function App() {
  const exportRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < COLLAPSE_BREAKPOINT)
  const [exportOpen, setExportOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const manualOverride = useRef(false)

  // 点击外部关闭导出菜单
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    if (exportOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [exportOpen])

  const handleImport = () => fileInputRef.current?.click()
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const text = await file.text()
      exportRef.current?.importMarkdown(text)
    } else if (ext === 'docx') {
      const arrayBuffer = await file.arrayBuffer()
      const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
      exportRef.current?.importHTML(html)
    } else if (ext === 'pdf') {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const lines: string[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const text = content.items.map((item: any) => item.str).join('')
        lines.push(text)
      }
      exportRef.current?.importMarkdown(lines.join('\n\n'))
    }
    e.target.value = ''
  }

  // 窗口变窄时自动折叠，变宽时自动展开（除非用户手动操作过）
  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < COLLAPSE_BREAKPOINT
      if (manualOverride.current) {
        // 用户手动操作后，只在跨越断点时重置 override
        if (narrow !== sidebarCollapsed) {
          manualOverride.current = false
          setSidebarCollapsed(narrow)
        }
        return
      }
      setSidebarCollapsed(narrow)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sidebarCollapsed])

  const toggleSidebar = useCallback(() => {
    manualOverride.current = true
    setSidebarCollapsed(v => !v)
  }, [])

  return (
    <BrowserRouter>
      <div className="h-screen bg-white flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 h-12 flex items-center px-4 shrink-0 z-10">
          <button
            onClick={toggleSidebar}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-500 transition-colors mr-3"
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <h1 className="text-base font-semibold text-gray-800 tracking-tight">Doco</h1>
          <div className="ml-auto text-sm text-gray-500 flex items-center gap-4">
            <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,.docx,.pdf" onChange={handleFileChange} className="hidden" />
            <button onClick={handleImport} className="hover:text-blue-600 transition-colors flex items-center gap-1" title="导入文档">
              <Upload size={14} />导入
            </button>
            <span className="text-gray-300">|</span>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportOpen(v => !v)}
                className="hover:text-blue-600 transition-colors flex items-center gap-1"
              >
                <Download size={14} />导出<ChevronDown size={12} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px] z-50">
                  <button
                    onClick={() => { exportRef.current?.exportMarkdown(); setExportOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
                  >Markdown</button>
                  <button
                    onClick={() => { exportRef.current?.exportWord(); setExportOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
                  >Word</button>
                  <button
                    onClick={() => { exportRef.current?.exportPDF(); setExportOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
                  >PDF</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
          <main className="flex-1 overflow-y-auto bg-gray-50">
            <Routes>
              <Route path="/" element={<EditorPage exportRef={exportRef} />} />
              <Route path="/doc/:id" element={<EditorPage exportRef={exportRef} />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  )
}

export default App
