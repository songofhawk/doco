import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef } from 'react'
import { Maximize2, Edit3 } from 'lucide-react'
import { createPortal } from 'react-dom'
import mermaid from 'mermaid'

const MERMAID_SCALE = 0.8
const MERMAID_MAX_VIEWPORT_HEIGHT = 1080
const MIN_FULLSCREEN_SCALE = 0.2
const MAX_FULLSCREEN_SCALE = 4
const FULLSCREEN_ZOOM_SENSITIVITY = 0.0015

mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    themeVariables: {
        fontFamily: 'arial'
    }
})

const normalizeMermaidSvg = (rawSvg: string) => {
    try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(rawSvg, 'image/svg+xml')
        const svgEl = doc.querySelector('svg')

        if (!svgEl) return rawSvg

        const width = svgEl.getAttribute('width')
        const height = svgEl.getAttribute('height')
        const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number)

        let svgWidth = width ? Number.parseFloat(width) : NaN
        let svgHeight = height ? Number.parseFloat(height) : NaN

        if ((!Number.isFinite(svgWidth) || !Number.isFinite(svgHeight)) && viewBox && viewBox.length === 4) {
            svgWidth = viewBox[2]
            svgHeight = viewBox[3]
        }

        if (Number.isFinite(svgWidth) && Number.isFinite(svgHeight)) {
            svgEl.setAttribute('width', String(svgWidth * MERMAID_SCALE))
            svgEl.setAttribute('height', String(svgHeight * MERMAID_SCALE))
        }

        svgEl.style.maxWidth = 'none'
        svgEl.style.width = 'max-content'
        svgEl.style.height = 'auto'
        svgEl.style.display = 'block'
        svgEl.style.backgroundColor = '#fff'

        return new XMLSerializer().serializeToString(svgEl)
    } catch {
        return rawSvg
    }
}

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
                const { svg: rawSvg } = await mermaid.render(id.current, code)
                if (isMounted) {
                    setSvg(normalizeMermaidSvg(rawSvg))
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

    useEffect(() => {
        if (!isFullscreen) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [isFullscreen])

    const handleBlur = () => {
        setIsEditing(false)
        props.updateAttributes({ code })
    }

    const handleDoubleClick = () => {
        setIsEditing(true)
    }

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        e.stopPropagation()

        if (e.ctrlKey || e.metaKey) {
            const zoomDelta = Math.exp(-e.deltaY * FULLSCREEN_ZOOM_SENSITIVITY)
            setScale(s => Math.min(Math.max(MIN_FULLSCREEN_SCALE, s * zoomDelta), MAX_FULLSCREEN_SCALE))
            return
        }

        setPosition(prev => ({
            x: prev.x - e.deltaX,
            y: prev.y - e.deltaY
        }))
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (e.button === 0) {
            setIsDragging(true)
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
        }
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isDragging) {
            setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
        }
    }

    const handleMouseUp = (e?: React.MouseEvent) => {
        e?.stopPropagation()
        setIsDragging(false)
    }

    const openFullscreen = () => {
        setScale(1)
        setPosition({ x: 0, y: 0 })
        setIsFullscreen(true)
    }

    const diagramViewportStyle = {
        maxHeight: `${MERMAID_MAX_VIEWPORT_HEIGHT}px`,
    }

    const diagramContentClassName = 'inline-block min-w-full w-max'

    return (
        <>
            <NodeViewWrapper className="mermaid-block my-6 max-w-full border border-gray-100 rounded-lg overflow-hidden bg-white group shadow-sm transition-shadow hover:shadow-md relative">
                {isEditing ? (
                    <div className="flex flex-col">
                        <textarea
                            className="w-full h-96 p-4 font-mono text-sm bg-gray-50 border-b border-gray-200 outline-none resize-y text-gray-700"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onBlur={handleBlur}
                            autoFocus
                            spellCheck={false}
                            placeholder="输入 Mermaid 代码..."
                        />
                        <div className="p-4 bg-white overflow-auto max-w-full" style={diagramViewportStyle}>
                            {error ? (
                                <div className="text-red-500 text-sm whitespace-pre-wrap">{error}</div>
                            ) : (
                                <div
                                    className={diagramContentClassName}
                                    dangerouslySetInnerHTML={{ __html: svg }}
                                />
                            )}
                        </div>
                    </div>
                ) : (
                    <div
                        className="p-6 cursor-pointer bg-gray-50/50 overflow-auto max-w-full"
                        style={diagramViewportStyle}
                        onDoubleClick={handleDoubleClick}
                    >
                        {error ? (
                            <div className="text-red-400 text-sm">解析异常: 双击以编辑修复。</div>
                        ) : svg ? (
                            <div
                                className={diagramContentClassName}
                                dangerouslySetInnerHTML={{ __html: svg }}
                            />
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
                        className="select-none bg-white p-6 rounded-lg shadow-2xl absolute top-1/2 left-1/2"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})`,
                            transformOrigin: 'center',
                            width: 'max-content',
                            height: 'max-content',
                            minWidth: 'fit-content',
                            minHeight: 'fit-content',
                            touchAction: 'none',
                        }}
                    >
                        {error ? (
                            <div className="text-red-500 text-sm">{error}</div>
                        ) : (
                            <div
                                className="inline-block"
                                style={{ backgroundColor: '#fff' }}
                                dangerouslySetInnerHTML={{ __html: svg }}
                            />
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}

export default MermaidComponent
