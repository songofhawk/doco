import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, X } from 'lucide-react'
import { WECHAT_THEMES, renderWechatHtml } from '../wechat/wechatExport'

interface WeChatExportDialogProps {
    open: boolean
    title: string
    getMarkdown: () => string
    onClose: () => void
}

/**
 * 公众号导出对话框：预览 + 换肤 + 复制到剪贴板
 * 复制内容为 text/html 富文本，直接粘贴到公众号后台即可带样式
 */
export function WeChatExportDialog({ open, title, getMarkdown, onClose }: WeChatExportDialogProps) {
    const [themeId, setThemeId] = useState(WECHAT_THEMES[0].id)
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
    const [html, setHtml] = useState('')

    // 打开或换肤时重新生成（juice 按需加载，渲染是异步的）
    useEffect(() => {
        if (!open) return
        let cancelled = false
        const theme = WECHAT_THEMES.find(t => t.id === themeId) ?? WECHAT_THEMES[0]
        renderWechatHtml(getMarkdown(), theme.css)
            .then(result => { if (!cancelled) setHtml(result) })
            .catch(err => {
                console.error('公众号 HTML 生成失败', err)
                if (!cancelled) setHtml('')
            })
        return () => { cancelled = true }
    }, [open, themeId, getMarkdown])

    // ESC 关闭；打开时重置复制状态
    useEffect(() => {
        if (!open) return
        setCopyState('idle')
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, onClose])

    if (!open) return null

    const handleCopy = async () => {
        if (!html) return
        try {
            // 富文本复制：text/html 为主，text/plain 兜底
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([html], { type: 'text/plain' }),
                }),
            ])
            setCopyState('copied')
        } catch {
            try {
                await navigator.clipboard.writeText(html)
                setCopyState('copied')
            } catch (err) {
                console.error('复制失败', err)
                setCopyState('error')
            }
        }
    }

    const handleDownload = () => {
        if (!html) return
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${title || 'document'}.wechat.html`
        link.click()
        URL.revokeObjectURL(link.href)
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
        >
            <div
                className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* 标题栏 */}
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                    <div className="text-sm font-medium text-gray-800">导出到公众号</div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        aria-label="关闭"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* 主题选择 */}
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
                    <span className="text-xs text-gray-400">样式</span>
                    {WECHAT_THEMES.map(theme => (
                        <button
                            key={theme.id}
                            type="button"
                            onClick={() => { setThemeId(theme.id); setCopyState('idle') }}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors ${themeId === theme.id
                                ? 'border-violet-500 bg-violet-50 text-violet-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                }`}
                        >
                            {theme.name}
                        </button>
                    ))}
                </div>

                {/* 预览区 */}
                <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
                    {html ? (
                        <div
                            className="mx-auto max-w-2xl bg-white shadow-sm"
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                    ) : (
                        <div className="py-20 text-center text-sm text-gray-400">生成失败，请重试</div>
                    )}
                </div>

                {/* 操作栏 */}
                <div className="flex items-center gap-3 border-t border-gray-100 px-5 py-3">
                    <button
                        type="button"
                        onClick={() => { void handleCopy() }}
                        disabled={!html}
                        className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                    >
                        {copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
                        {copyState === 'copied' ? '已复制，去公众号后台粘贴' : '复制到剪贴板'}
                    </button>
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!html}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                        <Download size={15} />
                        下载 HTML
                    </button>
                    {copyState === 'error' && (
                        <span className="text-xs text-red-500">复制失败，请用"下载 HTML"后在浏览器中手动复制</span>
                    )}
                    {copyState !== 'error' && (
                        <span className="ml-auto text-xs text-gray-400">复制后直接粘贴到公众号编辑器，样式会自动带入</span>
                    )}
                </div>

                {/* 致谢 */}
                <div className="border-t border-gray-50 px-5 py-1.5 text-right text-[11px] text-gray-300">
                    排版主题来自{' '}
                    <a
                        href="https://github.com/zhylq/yuan-skills"
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-gray-200 underline-offset-2 hover:text-gray-400"
                    >
                        zhy-markdown2wechat
                    </a>
                    ，感谢作者 zhylq
                </div>
            </div>
        </div>,
        document.body,
    )
}
