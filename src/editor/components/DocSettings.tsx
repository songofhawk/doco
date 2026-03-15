import { useState, useRef, useEffect } from 'react'
import { Settings, ListOrdered, Palette, Clock } from 'lucide-react'
import { DocHistory } from './DocHistory'

const BG_COLORS = [
    { label: '默认白', value: '#ffffff' },
    { label: '暖黄', value: '#fffbeb' },
    { label: '淡青', value: '#f0fdfa' },
    { label: '浅灰', value: '#f9fafb' },
    { label: '淡蓝', value: '#eff6ff' },
    { label: '淡紫', value: '#faf5ff' },
    { label: '淡粉', value: '#fff1f2' },
]

interface DocSettingsProps {
    docId: string
    headingNumbered: boolean
    onToggleNumbered: () => void
    bgColor: string
    onBgColorChange: (color: string) => void
}

export function DocSettings({ docId, headingNumbered, onToggleNumbered, bgColor, onBgColorChange }: DocSettingsProps) {
    const [open, setOpen] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)

    // 点击外部关闭
    useEffect(() => {
        if (!open || showHistory) return
        const handler = (e: MouseEvent) => {
            if (panelRef.current?.contains(e.target as Node)) return
            if (btnRef.current?.contains(e.target as Node)) return
            setOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open, showHistory])

    return (
        <div className="relative">
            <button
                ref={btnRef}
                onClick={() => setOpen(v => !v)}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="文档设置"
            >
                <Settings size={16} />
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-2"
                >
                    <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                        文档设置
                    </div>

                    {/* 标题编号开关 */}
                    <button
                        onClick={onToggleNumbered}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                        <ListOrdered size={16} className="text-gray-500 shrink-0" />
                        <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700">标题多级编号</span>
                                <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-400 font-mono text-[10px]">⌘ ⌥ ⇧ J</kbd>
                            </div>
                        </div>
                        <div className={`w-8 h-[18px] rounded-full transition-colors relative ${headingNumbered ? 'bg-blue-500' : 'bg-gray-300'}`}>
                            <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${headingNumbered ? 'left-[16px]' : 'left-[2px]'}`} />
                        </div>
                    </button>

                    {/* 分割线 */}
                    <div className="mx-3 my-1.5 border-t border-gray-100" />

                    {/* 文档历史 */}
                    <button
                        onClick={() => { setShowHistory(true); setOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                        <Clock size={16} className="text-gray-500 shrink-0" />
                        <span className="text-sm text-gray-700">文档历史</span>
                    </button>

                    {/* 分割线 */}
                    <div className="mx-3 my-1.5 border-t border-gray-100" />

                    {/* 背景颜色 */}
                    <div className="px-3 py-2">
                        <div className="flex items-center gap-2 mb-2">
                            <Palette size={16} className="text-gray-500" />
                            <span className="text-sm text-gray-700">背景颜色</span>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                            {BG_COLORS.map(c => (
                                <button
                                    key={c.value}
                                    onClick={() => onBgColorChange(c.value)}
                                    title={c.label}
                                    className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 ${bgColor === c.value ? 'border-blue-500 shadow-sm' : 'border-gray-200'}`}
                                    style={{ backgroundColor: c.value }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {showHistory && (
                <DocHistory
                    docId={docId}
                    onClose={() => setShowHistory(false)}
                    onRestore={() => window.location.reload()}
                />
            )}
        </div>
    )
}
