import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { apiFetch } from '../auth'

type QuotaUsage = {
  knowledge_bases: { used: number; limit: number }
  documents_and_folders: { used: number; limit: number; documents: number; folders: number }
  per_document: { character_limit: number; ydoc_snapshot_byte_limit: number }
  folder_depth_limit: number
}

const numberFormatter = new Intl.NumberFormat('zh-CN')

const QuotaProgress = ({ label, used, limit, detail }: {
  label: string
  used: number
  limit: number
  detail?: string
}) => {
  const percentage = limit > 0 ? Math.min(100, used / limit * 100) : 0
  return (
    <div className="rounded-xl bg-[var(--surface-elevated)] px-4 py-3 shadow-[0_0_0_1px_var(--border-subtle)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
        <span className="text-sm tabular-nums text-[var(--text-secondary)]">
          {numberFormatter.format(used)} / {numberFormatter.format(limit)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${percentage}%` }} />
      </div>
      {detail && <p className="mt-2 text-xs text-[var(--text-tertiary)]">{detail}</p>}
    </div>
  )
}

export function QuotaDialog({ onClose }: { onClose: () => void }) {
  const [usage, setUsage] = useState<QuotaUsage | null>(null)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/quota')
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string }
          if (response.status === 404) throw new Error('当前后端尚未提供配额接口，请重启或更新后端服务')
          throw new Error(body.error || '配额信息加载失败')
        }
        return response.json() as Promise<QuotaUsage>
      })
      .then(data => { if (!cancelled) setUsage(data) })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : '暂时无法加载配额信息，请稍后重试')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onMouseDown={event => { if (!dialogRef.current?.contains(event.target as Node)) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-dialog-title"
        className="w-full max-w-md rounded-2xl bg-[var(--surface-elevated)] p-5 text-[var(--text-primary)] shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="quota-dialog-title" className="text-lg font-medium">配额与用量</h2>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">当前个人工作区的资源使用情况</p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : !usage ? (
          <div className="mt-5 space-y-3" aria-label="正在加载配额信息">
            <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-hover)]" />
            <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-hover)]" />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <QuotaProgress label="知识库" used={usage.knowledge_bases.used} limit={usage.knowledge_bases.limit} />
            <QuotaProgress
              label="文档与文件夹"
              used={usage.documents_and_folders.used}
              limit={usage.documents_and_folders.limit}
              detail={`文档 ${numberFormatter.format(usage.documents_and_folders.documents)} 个 · 文件夹 ${numberFormatter.format(usage.documents_and_folders.folders)} 个`}
            />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="rounded-xl bg-[var(--surface-elevated)] px-4 py-3 shadow-[0_0_0_1px_var(--border-subtle)]">
                <p className="text-xs text-[var(--text-tertiary)]">单篇文档上限</p>
                <p className="mt-1 text-sm font-medium tabular-nums">{numberFormatter.format(usage.per_document.character_limit)} 字</p>
              </div>
              <div className="rounded-xl bg-[var(--surface-elevated)] px-4 py-3 shadow-[0_0_0_1px_var(--border-subtle)]">
                <p className="text-xs text-[var(--text-tertiary)]">文件夹嵌套上限</p>
                <p className="mt-1 text-sm font-medium tabular-nums">{numberFormatter.format(usage.folder_depth_limit)} 层</p>
              </div>
            </div>
            <p className="px-1 text-xs leading-5 text-[var(--text-tertiary)]">
              每篇文档的协同数据快照上限为 {numberFormatter.format(usage.per_document.ydoc_snapshot_byte_limit / 1024 / 1024)} MiB。
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
