import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

export const MermaidComponent = (props: any) => {
    const [code, setCode] = useState(props.node.attrs.code)
    const [svg, setSvg] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const id = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`)

    useEffect(() => {
        let isMounted = true
        const renderDiagram = async () => {
            try {
                if (!code.trim()) {
                    if (isMounted) setSvg('')
                    return
                }
                const { svg } = await mermaid.render(id.current, code)
                if (isMounted) {
                    setSvg(svg)
                    setError(null)
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Syntax Error')
                }
            }
        }

        const timer = setTimeout(() => {
            renderDiagram()
        }, 300)

        return () => {
            isMounted = false
            clearTimeout(timer)
        }
    }, [code])

    const handleBlur = () => {
        setIsEditing(false)
        props.updateAttributes({ code })
    }

    const handleDoubleClick = () => {
        setIsEditing(true)
    }

    return (
        <NodeViewWrapper className="mermaid-block my-6 border border-gray-100 rounded-lg overflow-hidden bg-white group shadow-sm transition-shadow hover:shadow-md relative">
            {isEditing ? (
                <div className="flex flex-col">
                    <textarea
                        className="w-full h-40 p-4 font-mono text-sm bg-gray-50 border-b border-gray-200 outline-none resize-y text-gray-700"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onBlur={handleBlur}
                        autoFocus
                        spellCheck={false}
                        placeholder="输入 Mermaid 代码..."
                    />
                    <div className="p-4 flex justify-center bg-white min-h-[120px] items-center">
                        {error ? (
                            <div className="text-red-500 text-sm whitespace-pre-wrap">{error}</div>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: svg }} />
                        )}
                    </div>
                </div>
            ) : (
                <div
                    className="p-6 cursor-pointer flex justify-center min-h-[120px] items-center bg-gray-50/50"
                    onDoubleClick={handleDoubleClick}
                >
                    {error ? (
                        <div className="text-red-400 text-sm">解析异常: 双击以编辑修复。</div>
                    ) : svg ? (
                        <div dangerouslySetInnerHTML={{ __html: svg }} />
                    ) : (
                        <div className="text-gray-400 text-sm italic">双击编辑图表</div>
                    )}

                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => setIsEditing(true)}
                            className="bg-white border border-gray-200 shadow-sm px-3 py-1.5 text-xs rounded-md text-gray-600 hover:text-blue-600 font-medium"
                        >
                            编辑代码
                        </button>
                    </div>
                </div>
            )}
        </NodeViewWrapper>
    )
}

export default MermaidComponent
