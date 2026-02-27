import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { Copy, FileCode, WrapText } from 'lucide-react'
import { useState } from 'react'

export const CodeBlockComponent = ({ node, updateAttributes, extension }: any) => {
    const [copied, setCopied] = useState(false)
    const defaultLang = 'javascript'
    const currentLang = node.attrs.language || defaultLang
    const [wordWrap, setWordWrap] = useState(false)

    const languages = extension.options.lowlight.listLanguages() || ['javascript', 'typescript', 'html', 'css', 'json', 'python', 'java', 'cpp', 'rust']

    return (
        <NodeViewWrapper className="code-block rounded-lg overflow-hidden my-6" style={{ backgroundColor: 'var(--color-editor-codeblock-bg)', border: '1px solid var(--color-editor-codeblock-border)' }}>
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 text-gray-500 text-xs font-medium">
                <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-gray-400" />
                    <select
                        className="bg-transparent border-none outline-none cursor-pointer appearance-none hover:text-gray-900 transition-colors pl-1"
                        contentEditable={false}
                        value={currentLang}
                        onChange={event => updateAttributes({ language: event.target.value })}
                    >
                        <option value="null">自动识别</option>
                        {languages.map((lang: string, index: number) => (
                            <option key={index} value={lang}>
                                {lang}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-200 transition-colors ${wordWrap ? 'text-blue-600' : ''}`}
                        onClick={() => setWordWrap(!wordWrap)}
                        contentEditable={false}
                    >
                        <WrapText className="w-3.5 h-3.5" />
                        <span>自动换行</span>
                    </button>
                    <div className="w-[1px] h-3.5 bg-gray-300"></div>
                    <button
                        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
                        onClick={() => {
                            const text = node.textContent
                            navigator.clipboard.writeText(text)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2000)
                        }}
                        contentEditable={false}
                    >
                        <Copy className={`w-3.5 h-3.5 ${copied ? 'text-green-500' : ''}`} />
                        <span className={copied ? 'text-green-600' : ''}>{copied ? '已复制' : '复制'}</span>
                    </button>
                </div>
            </div>
            <pre className={`m-0 p-4 pt-4 text-sm font-mono overflow-auto bg-transparent border-none ${wordWrap ? 'whitespace-pre-wrap break-all' : ''}`}>
                <NodeViewContent as="div" className={`language-${currentLang}`} />
            </pre>
        </NodeViewWrapper>
    )
}
