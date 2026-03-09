import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Maximize2, Edit3 } from 'lucide-react'
import { createPortal } from 'react-dom'
import plantumlEncoder from 'plantuml-encoder'

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg'

export const PlantUMLComponent = (props: any) => {
    const [code, setCode] = useState(props.node.attrs.code)
    const [svgUrl, setSvgUrl] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
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
                // 放大 SVG 3 倍
                try {
                    const parser = new DOMParser()
                    const doc = parser.parseFromString(svg, 'image/svg+xml')
                    const svgEl = doc.querySelector('svg')
                    if (svgEl) {
                        const width = parseFloat(svgEl.getAttribute('width') || '0')
                        const height = parseFloat(svgEl.getAttribute('height') || '0')
                        if (width > 0 && height > 0) {
                            svgEl.setAttribute('width', String(width * 3))
                            svgEl.setAttribute('height', String(height * 3))
                            setSvgUrl(new XMLSerializer().serializeToString(svgEl))
                        } else {
                            setSvgUrl(svg)
                        }
                    } else {
                        setSvgUrl(svg)
                    }
                } catch {
                    setSvgUrl(svg)
                }
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

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        const delta = e.deltaY > 0 ? 0.9 : 1.1
        setScale(s => Math.min(Math.max(0.1, s * delta), 5))
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) {
            setIsDragging(true)
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
        }
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
        }
    }

    const handleMouseUp = () => {
        setIsDragging(false)
    }

    const openFullscreen = () => {
        setScale(1)
        setPosition({ x: 0, y: 0 })
        setIsFullscreen(true)
    }

    return (
        <>
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
                        <div className="p-4 bg-white overflow-auto" style={{ maxHeight: 'none' }}>
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
                        className="p-6 cursor-pointer bg-gray-50/50 overflow-auto"
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

                        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                            <button
                                onClick={() => setIsEditing(true)}
                                className="bg-white border border-gray-200 shadow-sm p-2 rounded-md text-gray-600 hover:text-blue-600"
                                title="编辑代码"
                            >
                                <Edit3 size={16} />
                            </button>
                            <button
                                onClick={openFullscreen}
                                className="bg-white border border-gray-200 shadow-sm p-2 rounded-md text-gray-600 hover:text-blue-600"
                                title="全屏查看"
                            >
                                <Maximize2 size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </NodeViewWrapper>

            {isFullscreen && createPortal(
                <div
                    className="fixed inset-0 bg-black/80 z-50 overflow-hidden"
                    onClick={() => setIsFullscreen(false)}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                >
                    <div
                        className="select-none absolute top-1/2 left-1/2"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})`,
                            transformOrigin: 'center',
                        }}
                    >
                        {loading ? (
                            <div className="text-gray-400 text-sm bg-white p-4 rounded">渲染中...</div>
                        ) : error ? (
                            <div className="text-red-500 text-sm bg-white p-4 rounded">{error}</div>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: svgUrl }} />
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}

export default PlantUMLComponent
