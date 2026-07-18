import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, KeyRound, Trash2, X } from 'lucide-react'
import { apiFetch } from '../auth'

type TokenRow = {
  id: string
  name: string
  scopes: string[]
  created_at: number
  last_used_at?: number | null
  expires_at?: number | null
  revoked_at?: number | null
}

export function ApiTokenDialog({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [name, setName] = useState('')
  const [access, setAccess] = useState<'read_only' | 'read_write'>('read_write')
  const [createdToken, setCreatedToken] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    const response = await apiFetch('/api-tokens')
    if (!response.ok) throw new Error('Token 列表加载失败')
    const data = await response.json()
    setTokens(data.tokens || [])
  }

  useEffect(() => { load().catch((err) => setError(err.message)) }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const create = async () => {
    if (!name.trim()) return
    setSubmitting(true); setError('')
    try {
      const response = await apiFetch('/api-tokens', { method: 'POST', body: JSON.stringify({ name: name.trim(), access }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Token 创建失败')
      setCreatedToken(data.token); setName(''); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Token 创建失败') }
    finally { setSubmitting(false) }
  }

  const revoke = async (id: string) => {
    if (!window.confirm('撤销后，此 Token 会立即失效。确定撤销？')) return
    const response = await apiFetch(`/api-tokens/${id}`, { method: 'DELETE' })
    if (response.ok) await load()
  }

  const copy = async () => {
    await navigator.clipboard.writeText(createdToken)
    setCopied(true); window.setTimeout(() => setCopied(false), 1500)
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="api-token-title" className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center border-b border-gray-100 px-5 py-4">
          <KeyRound size={18} className="mr-2 text-blue-600" />
          <h2 id="api-token-title" className="font-semibold text-gray-800">API 管理</h2>
          <button onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-5">
          <p className="mb-4 text-sm leading-6 text-gray-500">
            Token 仅用于 <code>/api/v1/*</code>，完整值只会显示一次。请像密码一样妥善保存。
            <a
              href="/api-docs"
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-blue-600 hover:underline"
            >
              查看 API 文档
            </a>
          </p>
          <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：本地 Agent" maxLength={100} className="min-h-10 flex-1 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400" />
            <select value={access} onChange={(event) => setAccess(event.target.value as typeof access)} className="min-h-10 rounded-md border border-gray-200 bg-white px-3 text-sm">
              <option value="read_write">读写</option><option value="read_only">只读</option>
            </select>
            <button disabled={!name.trim() || submitting} onClick={create} className="min-h-10 rounded-md bg-blue-600 px-4 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{submitting ? '创建中…' : '创建 Token'}</button>
          </div>
          {createdToken && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 text-sm font-medium text-amber-900">请立即复制，关闭后无法再次查看</p>
              <div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded bg-white p-2 text-xs text-gray-700">{createdToken}</code><button onClick={copy} className="rounded-md border border-amber-300 bg-white p-2 text-amber-800">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-6 space-y-2">
            {tokens.map((token) => (
              <div key={token.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-gray-800">{token.name}</div><div className="mt-1 truncate font-mono text-xs text-gray-400">{token.id} · {token.scopes.length} scopes</div></div>
                <div className="hidden text-right text-xs text-gray-400 sm:block">{new Date(token.created_at).toLocaleDateString()}<br />{token.revoked_at ? '已撤销' : token.last_used_at ? '已使用' : '未使用'}</div>
                {!token.revoked_at && <button onClick={() => revoke(token.id)} className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" title="撤销"><Trash2 size={16} /></button>}
              </div>
            ))}
            {!tokens.length && <p className="py-6 text-center text-sm text-gray-400">尚未创建 Token</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
