import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, Info, X } from 'lucide-react'
import { WECHAT_THEMES, renderWechatHtml } from '../wechat/wechatExport'

interface WeChatExportDialogProps {
    open: boolean
    title: string
    getMarkdown: () => string
    onClose: () => void
}

/**
 * HTML 导出对话框：预览 + 换肤 + 复制到剪贴板
 * 复制内容为 text/html 富文本，可直接粘贴到支持富文本的编辑器
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
                console.error('HTML 生成失败', err)
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
        link.download = `${title || 'document'}.html`
        link.click()
        URL.revokeObjectURL(link.href)
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#141413]/40 p-4"
            onClick={onClose}
        >
            <div
                className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--surface-elevated)] shadow-[0_4px_24px_rgba(20,20,19,0.12)] ring-1 ring-[var(--border-subtle)]"
                onClick={e => e.stopPropagation()}
            >
                {/* 标题栏 */}
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-header)] px-5 py-3.5">
                    <div>
                        <div className="text-sm font-medium text-[var(--text-primary)]">导出 HTML</div>
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">选择一套排版主题，预览后复制或下载</div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                        aria-label="关闭"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* 主题选择 */}
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-header)] px-5 py-3">
                    <span className="mr-1 text-xs font-medium tracking-wide text-[var(--text-secondary)]">排版主题</span>
                    {WECHAT_THEMES.map(theme => (
                        <button
                            key={theme.id}
                            type="button"
                            onClick={() => { setThemeId(theme.id); setCopyState('idle') }}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/25 ${themeId === theme.id
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent-strong)]'
                                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'
                                }`}
                        >
                            {theme.name}
                        </button>
                    ))}
                </div>

                {/* 预览区 */}
                <div className="flex-1 overflow-y-auto bg-[var(--surface-app)] p-5 sm:p-6">
                    {html ? (
                        <div
                            className="mx-auto max-w-2xl overflow-hidden bg-[var(--surface-elevated)] shadow-[0_4px_24px_rgba(20,20,19,0.05)] ring-1 ring-[var(--border-subtle)]"
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                    ) : (
                        <div className="py-20 text-center text-sm text-[var(--text-muted)]">生成失败，请重试</div>
                    )}
                </div>

                {/* 操作栏 */}
                <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-header)] px-5 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => { void handleCopy() }}
                        disabled={!html}
                        className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--surface-header)] shadow-[0_0_0_1px_var(--accent)] transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
                        {copyState === 'copied' ? '已复制 HTML' : '复制到剪贴板'}
                    </button>
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!html}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Download size={15} />
                        下载 HTML
                    </button>
                    {copyState === 'error' && (
                        <span className="text-xs leading-5 text-[var(--danger)]">复制失败，请用“下载 HTML”后在浏览器中手动复制</span>
                    )}
                    </div>
                    {copyState !== 'error' && (
                        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--text-muted)]">
                            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>复制后可粘贴到支持富文本的编辑器，样式会自动带入。</span>
                        </p>
                    )}
                </div>

                {/* 致谢 */}
                <div className="flex flex-wrap items-center justify-center gap-x-1 border-t border-[var(--border-subtle)] bg-[var(--surface-app)] px-5 py-2 text-center text-[11px] leading-5 text-[var(--text-muted)]">
                    <span>排版主题来自</span>
                    <a
                        href="https://github.com/zhylq/yuan-skills"
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text-secondary)]"
                    >
                        zhy-markdown2wechat
                    </a>
                    <span>，感谢作者 zhylq</span>
                </div>
            </div>
        </div>,
        document.body,
    )
}
