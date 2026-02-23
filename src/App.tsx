import React, { useRef } from 'react'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import { Editor } from './components/Editor'
import { Sidebar } from './components/Sidebar'

const EditorPage = ({ exportRef }: { exportRef: any }) => {
  const { id } = useParams<{ id: string }>()
  if (!id) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <div className="text-4xl mb-4">📄</div>
        <p className="text-lg font-medium">请从左侧选择或创建一个文档开始编辑</p>
      </div>
    )
  }
  return <Editor ref={exportRef} docId={id} key={id} />
}

function App() {
  const exportRef = useRef<any>(null)

  return (
    <BrowserRouter>
      <div className="h-screen bg-white flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 h-14 flex items-center px-6 shrink-0 z-10 transition-shadow">
          <h1 className="text-lg font-semibold text-gray-800 tracking-tight">Doco Editor</h1>
          <div className="ml-auto text-sm text-gray-500 font-medium flex items-center gap-6">
            <span className="text-gray-300">|</span>
            <button onClick={() => exportRef.current?.exportMarkdown()} className="hover:text-blue-600 transition-colors">导出 MD</button>
            <button onClick={() => exportRef.current?.exportWord()} className="hover:text-blue-600 transition-colors">导出 Word</button>
            <button onClick={() => exportRef.current?.exportPDF()} className="hover:text-blue-600 transition-colors">导出 PDF</button>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
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
