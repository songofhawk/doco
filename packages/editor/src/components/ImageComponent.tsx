import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { AlignLeft, AlignCenter, AlignRight, Trash2 } from 'lucide-react'

export const ImageComponent = ({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) => {
    const { src, alt, width, align } = node.attrs as any
    const imgRef = useRef<HTMLImageElement>(null)
    const [resizing, setResizing] = useState(false)
    const startX = useRef(0)
    const startWidth = useRef(0)

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setResizing(true)
        startX.current = e.clientX
        startWidth.current = imgRef.current?.offsetWidth || 0
    }, [])

    useEffect(() => {
        if (!resizing) return

        const onMouseMove = (e: MouseEvent) => {
            const diff = e.clientX - startX.current
            const newWidth = Math.max(100, startWidth.current + diff)
            const container = imgRef.current?.closest('.ProseMirror')
            const maxWidth = container ? container.clientWidth : 800
            const clampedWidth = Math.min(newWidth, maxWidth)
            if (imgRef.current) {
                imgRef.current.style.width = `${clampedWidth}px`
            }
        }

        const onMouseUp = (e: MouseEvent) => {
            setResizing(false)
            const diff = e.clientX - startX.current
            const newWidth = Math.max(100, startWidth.current + diff)
            const container = imgRef.current?.closest('.ProseMirror')
            const maxWidth = container ? container.clientWidth : 800
            updateAttributes({ width: Math.min(newWidth, maxWidth) })
        }

        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
        return () => {
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
        }
    }, [resizing, updateAttributes])

    const alignClass =
        align === 'center' ? 'mx-auto' :
        align === 'right' ? 'ml-auto' : ''

    return (
        <NodeViewWrapper
            className={`image-node-wrapper ${alignClass}`}
            data-align={align || 'left'}
            style={{ display: 'flex', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}
        >
            <div className={`relative inline-block group ${selected ? 'image-selected' : ''}`}>
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt || ''}
                    style={{ width: width ? `${width}px` : undefined }}
                    className="rounded-lg block max-w-full"
                    draggable={false}
                />

                {/* 调整大小手柄 */}
                {selected && (
                    <div
                        className="resize-handle resize-handle-right"
                        onMouseDown={onMouseDown}
                    />
                )}
            </div>
        </NodeViewWrapper>
    )
}

function ImageToolbar({ align, onAlign, onDelete }: {
    align: string
    onAlign: (align: string) => void
    onDelete: () => void
}) {
    const buttons = [
        { icon: AlignLeft, value: 'left', tooltip: '靠左' },
        { icon: AlignCenter, value: 'center', tooltip: '居中' },
        { icon: AlignRight, value: 'right', tooltip: '靠右' },
    ]

    return (
        <div className="image-toolbar">
            {buttons.map(({ icon: Icon, value, tooltip }) => (
                <button
                    key={value}
                    onClick={(e) => { e.preventDefault(); onAlign(value) }}
                    className={`image-toolbar-btn ${align === value ? 'active' : ''}`}
                    title={tooltip}
                >
                    <Icon className="w-4 h-4" />
                </button>
            ))}
            <div className="w-px h-4 bg-gray-200 mx-0.5" />
            <button
                onClick={(e) => { e.preventDefault(); onDelete() }}
                className="image-toolbar-btn text-red-500 hover:bg-red-50"
                title="删除"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    )
}
