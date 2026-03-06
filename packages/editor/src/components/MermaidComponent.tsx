import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef } from 'react'
import { Maximize2, Edit3 } from 'lucide-react'
import { createPortal } from 'react-dom'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

export const MermaidComponent = (props: any) => {
    const [code, setCode] = useState(props.node.attrs.code)
    const [svg, setSvg] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
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
        setScale(2)
        setPosition({ x: 0, y: 0 })
        setIsFullscreen(true)
    }

    return (
        <>
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
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
                    onClick={() => setIsFullscreen(false)}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                >
                    <div
                        className="select-none"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                            transformOrigin: 'center',
                        }}
                    >
                        {error ? (
                            <div className="text-red-500 text-sm bg-white p-4 rounded">{error}</div>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: svg }} />
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}

export default MermaidComponent
