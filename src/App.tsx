import { useRef } from 'react'
import { Editor } from './components/Editor'

function App() {
  const exportRef = useRef<any>(null)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 h-14 flex items-center px-6 sticky top-0 z-10 transition-shadow">
        <h1 className="text-lg font-semibold text-gray-800 tracking-tight">Doco Editor</h1>
        <div className="ml-auto text-sm text-gray-500 font-medium flex items-center gap-6">
          <span className="text-gray-300">|</span>
          <button onClick={() => exportRef.current?.exportMarkdown()} className="hover:text-blue-600 transition-colors">导出 MD</button>
          <button onClick={() => exportRef.current?.exportWord()} className="hover:text-blue-600 transition-colors">导出 Word</button>
          <button onClick={() => exportRef.current?.exportPDF()} className="hover:text-blue-600 transition-colors">导出 PDF</button>
        </div>
      </header>
      <main className="flex-1 w-full pb-20">
        <Editor ref={exportRef} />
      </main>
    </div>
  )
}

export default App
