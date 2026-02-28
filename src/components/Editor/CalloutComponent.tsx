import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { useState, useRef } from 'react'

const CALLOUT_PRESETS: { emoji: string; color: string; label: string }[] = [
    { emoji: '💡', color: 'blue', label: '提示' },
    { emoji: '⚠️', color: 'yellow', label: '警告' },
    { emoji: '❌', color: 'red', label: '危险' },
    { emoji: '✅', color: 'green', label: '成功' },
    { emoji: '📝', color: 'gray', label: '备注' },
    { emoji: '🔥', color: 'orange', label: '重要' },
    { emoji: '💜', color: 'purple', label: '灵感' },
]

export function CalloutComponent({ node, updateAttributes }: any) {
    const [showPicker, setShowPicker] = useState(false)
    const btnRef = useRef<HTMLButtonElement>(null)
    const { emoji, color } = node.attrs

    return (
        <NodeViewWrapper className={`callout callout-${color}`} data-type="callout">
            <button
                ref={btnRef}
                className="callout-emoji-btn"
                contentEditable={false}
                onClick={() => setShowPicker(!showPicker)}
            >
                {emoji}
            </button>
            {showPicker && (
                <div className="callout-picker" contentEditable={false}>
                    {CALLOUT_PRESETS.map(p => (
                        <button
                            key={p.color}
                            className="callout-picker-item"
                            onClick={() => {
                                updateAttributes({ emoji: p.emoji, color: p.color })
                                setShowPicker(false)
                            }}
                        >
                            <span>{p.emoji}</span>
                            <span className="text-xs text-gray-500">{p.label}</span>
                        </button>
                    ))}
                </div>
            )}
            <NodeViewContent className="callout-content" />
        </NodeViewWrapper>
    )
}
