import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import plantumlEncoder from 'plantuml-encoder'

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg'

export const PlantUMLComponent = (props: any) => {
    const [code, setCode] = useState(props.node.attrs.code)
    const [svgUrl, setSvgUrl] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [loading, setLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)

    const renderDiagram = useCallback(async (source: string) => {
        if (!source.trim()) {
            setSvgUrl('')
            return
        }
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setLoading(true)
        try {
            const encoded = plantumlEncoder.encode(source)
            const url = `${PLANTUML_SERVER}/${encoded}`
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) throw new Error(`PlantUML 服务返回 ${res.status}`)
            const svg = await res.text()
            if (svg.includes('<svg')) {
                setSvgUrl(svg)
                setError(null)
            } else {
                setError('PlantUML 语法错误')
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                setError(err.message || '渲染失败')
            }
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => renderDiagram(code), 500)
        return () => clearTimeout(timer)
    }, [code, renderDiagram])

    const handleBlur = () => {
        setIsEditing(false)
        props.updateAttributes({ code })
    }

    return (
        <NodeViewWrapper className="plantuml-block my-6 border border-gray-100 rounded-lg overflow-hidden bg-white group shadow-sm transition-shadow hover:shadow-md relative">
            {isEditing ? (
                <div className="flex flex-col">
                    <textarea
                        className="w-full h-40 p-4 font-mono text-sm bg-gray-50 border-b border-gray-200 outline-none resize-y text-gray-700"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onBlur={handleBlur}
                        autoFocus
                        spellCheck={false}
                        placeholder="输入 PlantUML 代码..."
                    />
                    <div className="p-4 flex justify-center bg-white min-h-[120px] items-center">
                        {loading ? (
                            <div className="text-gray-400 text-sm">渲染中...</div>
                        ) : error ? (
                            <div className="text-red-500 text-sm whitespace-pre-wrap">{error}</div>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: svgUrl }} />
                        )}
                    </div>
                </div>
            ) : (
                <div
                    className="p-6 cursor-pointer flex justify-center min-h-[120px] items-center bg-gray-50/50"
                    onDoubleClick={() => setIsEditing(true)}
                >
                    {loading ? (
                        <div className="text-gray-400 text-sm">渲染中...</div>
                    ) : error ? (
                        <div className="text-red-400 text-sm">解析异常: 双击以编辑修复。</div>
                    ) : svgUrl ? (
                        <div dangerouslySetInnerHTML={{ __html: svgUrl }} />
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

export default PlantUMLComponent
