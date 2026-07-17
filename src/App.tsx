import React, { useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, Link, Routes, Route, useParams } from 'react-router-dom'
import { DocoEditor, StandaloneSpreadsheetPage } from './editor'
import { Sidebar } from './components/Sidebar'
import { FileText, ChevronDown, LogOut, KeyRound, Mail, ArrowLeft, LoaderCircle, Check } from 'lucide-react'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import { AuthProvider, apiFetch, type AppearanceTheme, type CurrentUser, useAuth } from './auth'
import { ApiTokenDialog } from './components/ApiTokenDialog'
import { DocoLogo, DocoWordmark } from './components/DocoLogo'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-5">
      <FileText size={28} className="text-gray-300" />
    </div>
    <p className="text-base font-medium text-gray-500 mb-2">选择或创建一个文档</p>
    <p className="text-sm text-gray-400">从左侧知识库中打开文档，或新建一个开始写作</p>
    <div className="mt-8 flex flex-col gap-2 text-xs text-gray-400">
      <div className="flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">/</kbd>
        <span>唤起命令菜单</span>
      </div>
      <div className="flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">Markdown</kbd>
        <span>支持 Markdown 语法</span>
      </div>
    </div>
  </div>
)

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const LoadingScreen = () => (
  <div className="h-screen bg-gray-50 flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
    <DocoLogo className="h-9 w-9" />
    <span>正在载入...</span>
  </div>
)

const LoginPage = () => {
  const { signInWithGoogleCredential, requestEmailCode, signInWithEmailCode } = useAuth()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [emailStep, setEmailStep] = useState<'email' | 'code'>('email')
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    let cancelled = false
    const renderButton = () => {
      if (cancelled || !buttonRef.current || !window.google) return
      buttonRef.current.innerHTML = ''
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response.credential) return
          try {
            setError('')
            await signInWithGoogleCredential(response.credential)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Google 登录失败')
          }
        },
      })
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        shape: 'rectangular',
        text: 'signin_with',
        width: 280,
      })
    }

    if (window.google) {
      renderButton()
      return () => { cancelled = true }
    }

    let script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (!script) {
      script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', renderButton)
    script.addEventListener('error', () => setError('Google 登录脚本加载失败'))

    return () => {
      cancelled = true
      script?.removeEventListener('load', renderButton)
    }
  }, [signInWithGoogleCredential])

  const sendEmailCode = async () => {
    if (submitting || cooldown > 0) return
    try {
      setSubmitting(true)
      setError('')
      const result = await requestEmailCode(email)
      setEmail(email.trim().toLowerCase())
      setEmailStep('code')
      setCooldown(result.retryAfterSeconds || 60)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  const verifyEmailCode = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    try {
      setSubmitting(true)
      setError('')
      await signInWithEmailCode(email, code)
    } catch (err) {
      setError(err instanceof Error ? err.message : '邮箱登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm px-8 py-9 flex flex-col items-center text-center">
        <h1 className="mb-5"><DocoWordmark className="doco-wordmark-large" /></h1>
        <p className="text-sm text-gray-500 mb-7 leading-relaxed">你的知识库与协同写作空间<br />使用邮箱或 Google 账号登录</p>

        <form onSubmit={emailStep === 'email' ? (event) => { event.preventDefault(); void sendEmailCode() } : verifyEmailCode} className="w-full text-left">
          {emailStep === 'email' ? (
            <>
              <label htmlFor="login-email" className="block text-xs font-medium text-gray-600 mb-2">邮箱地址</label>
              <div className="relative">
                <Mail size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  placeholder="name@example.com"
                  className="w-full h-11 rounded-lg border border-gray-300 bg-white pl-10 pr-3 text-sm text-gray-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-3 w-full h-11 rounded-lg bg-gray-900 text-white text-sm font-medium flex items-center justify-center gap-2 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <LoaderCircle size={16} className="animate-spin" />}
                发送验证码
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setEmailStep('email'); setCode(''); setError('') }}
                className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
              >
                <ArrowLeft size={14} /> 更换邮箱
              </button>
              <label htmlFor="login-code" className="block text-xs font-medium text-gray-600 mb-1">输入 6 位验证码</label>
              <p className="text-xs text-gray-400 mb-3 truncate">验证码已发送至 {email}</p>
              <input
                id="login-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                pattern="[0-9]{6}"
                placeholder="000000"
                className="w-full h-12 rounded-lg border border-gray-300 bg-white px-3 text-center text-lg tracking-[0.45em] text-gray-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="submit"
                disabled={submitting || code.length !== 6}
                className="mt-3 w-full h-11 rounded-lg bg-gray-900 text-white text-sm font-medium flex items-center justify-center gap-2 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <LoaderCircle size={16} className="animate-spin" />}
                登录
              </button>
              <button
                type="button"
                disabled={submitting || cooldown > 0}
                onClick={() => void sendEmailCode()}
                className="mt-3 w-full text-center text-xs text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
              >
                {cooldown > 0 ? `${cooldown} 秒后可重新发送` : '重新发送验证码'}
              </button>
            </>
          )}
        </form>

        {GOOGLE_CLIENT_ID && (
          <>
            <div className="my-6 w-full flex items-center gap-3 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200" />或<span className="h-px flex-1 bg-gray-200" />
            </div>
            <div ref={buttonRef} className="min-h-[44px]" />
          </>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
      <p className="mt-6 text-xs text-gray-400">多端实时同步 · 富文本协同编辑</p>
    </div>
  )
}

const LogoutConfirmDialog = ({ onConfirm, onClose }: {
  onConfirm: () => Promise<void>
  onClose: () => void
}) => {
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, submitting])

  const handleConfirm = async () => {
    setSubmitting(true)
    await onConfirm()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-dialog-title"
        aria-describedby="logout-dialog-description"
        className="w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
      >
        <h2 id="logout-dialog-title" className="text-lg font-medium text-[var(--text-primary)]">确认退出登录？</h2>
        <p id="logout-dialog-description" className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          退出后，需要重新使用邮箱或 Google 账号登录才能访问你的知识库。
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            autoFocus
            className="min-h-11 rounded-lg bg-[var(--surface-hover)] px-4 py-2 text-sm text-[var(--text-secondary)] shadow-[0_0_0_1px_var(--border-strong)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white shadow-[0_0_0_1px_var(--accent)] transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '正在退出...' : '确认退出'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type ExternalDocTitle = { docId: string; title: string }

const EditorPage = ({ exportRef, externalTitle, user, onImportRequest, onActiveDocumentTitleChange }: {
  exportRef: any
  externalTitle?: ExternalDocTitle
  user: CurrentUser
  onImportRequest: () => void
  onActiveDocumentTitleChange: (title?: string) => void
}) => {
  const { id } = useParams<{ id: string }>()
  const [meta, setMeta] = useState<any>(undefined)
  const renamedTitle = externalTitle && externalTitle.docId === id ? externalTitle.title : undefined
  const activeTitle = meta && meta.docId === id ? (renamedTitle ?? meta.title) : undefined

  useEffect(() => {
    onActiveDocumentTitleChange(id ? activeTitle : undefined)
  }, [activeTitle, id, onActiveDocumentTitleChange])

  useEffect(() => {
    setMeta(undefined)
    if (!id) return
    apiFetch(`/docs/${id}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setMeta({
        docId: id,
        title: d.title,
        documentType: d.document_type || 'document',
        headingNumbered: d.heading_numbered,
        bgColor: d.bg_color,
        collapsedBlocks: d.collapsed_blocks ? d.collapsed_blocks.split(',').filter(Boolean) : [],
      })
    }).catch(() => {})
  }, [id])
  if (!id) return <EmptyState />
  if (!meta || meta.docId !== id) return <LoadingScreen />
  if (meta.documentType === 'spreadsheet') {
    return (
      <StandaloneSpreadsheetPage
        key={`${user.id}:${id}:spreadsheet`}
        docId={id}
        userId={user.id}
        title={activeTitle}
        websocketUrl={import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'}
        onTitleChange={(title) => {
          setMeta((current: any) => current ? { ...current, title } : current)
          apiFetch(`/docs/${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
          }).catch(() => {})
        }}
      />
    )
  }
  return (
    <DocoEditor
      ref={exportRef}
      docId={id}
      userId={user.id}
      key={`${user.id}:${id}`}
      initialMeta={meta}
      collaboration={{ websocketUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws' }}
      onTitleChange={(docId, title) => {
        setMeta((current: any) => current ? { ...current, title } : current)
        apiFetch(`/docs/${docId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        }).catch(() => {})
      }}
      onSettingsChange={(docId, settings) => {
        const payload: any = { ...settings }
        if (settings.collapsedBlocks !== undefined) {
          payload.collapsed_blocks = settings.collapsedBlocks.join(',')
          delete payload.collapsedBlocks
        }
        if (settings.headingNumbered !== undefined) {
          payload.heading_numbered = settings.headingNumbered
          delete payload.headingNumbered
        }
        if (settings.bgColor !== undefined) {
          payload.bg_color = settings.bgColor
          delete payload.bgColor
        }
        apiFetch(`/docs/${docId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {})
      }}
      onImportRequest={onImportRequest}
      externalTitle={renamedTitle}
    />
  )
}

const COLLAPSE_BREAKPOINT = 768
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'doco-sidebar-collapsed'
const SIDEBAR_WIDTH_STORAGE_KEY = 'doco-sidebar-width'
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 420
const SIDEBAR_DEFAULT_WIDTH = 256

const clampSidebarWidth = (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))

const getInitialSidebarCollapsed = () => {
  if (window.innerWidth < COLLAPSE_BREAKPOINT) return true
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}

const getInitialSidebarWidth = () => {
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT_WIDTH
}

function AppShell() {
  const { user, loading, signOut, updateAppearance } = useAuth()
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [apiTokenOpen, setApiTokenOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>(() => {
    const stored = window.localStorage.getItem('doco-appearance-theme')
    return stored === 'paper' ? 'paper' : 'simple'
  })
  const exportRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [externalTitle, setExternalTitle] = useState<ExternalDocTitle | undefined>()
  const [activeDocumentTitle, setActiveDocumentTitle] = useState<string | undefined>()
  const [activeKnowledgeBaseTitle, setActiveKnowledgeBaseTitle] = useState<string | undefined>()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialSidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const wasNarrow = useRef(window.innerWidth < COLLAPSE_BREAKPOINT)

  useEffect(() => {
    document.documentElement.dataset.theme = appearanceTheme
    window.localStorage.setItem('doco-appearance-theme', appearanceTheme)
  }, [appearanceTheme])

  useEffect(() => {
    if (user?.appearanceTheme) setAppearanceTheme(user.appearanceTheme)
  }, [user?.appearanceTheme])

  useEffect(() => {
    document.title = activeDocumentTitle || activeKnowledgeBaseTitle || '知识库'
  }, [activeDocumentTitle, activeKnowledgeBaseTitle])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    if (accountMenuOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [accountMenuOpen])

  const handleAppearanceChange = useCallback((theme: AppearanceTheme) => {
    setAppearanceTheme(theme)
    setAccountMenuOpen(false)
    void updateAppearance(theme).catch((error) => {
      console.error('[Appearance] save failed:', error)
    })
  }, [updateAppearance])

  const handleImport = () => fileInputRef.current?.click()
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const text = await file.text()
      exportRef.current?.importMarkdown(text)
    } else if (ext === 'docx') {
      const arrayBuffer = await file.arrayBuffer()
      const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
      exportRef.current?.importHTML(html)
    } else if (ext === 'pdf') {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const lines: string[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const text = content.items.map((item: any) => item.str).join('')
        lines.push(text)
      }
      exportRef.current?.importMarkdown(lines.join('\n\n'))
    }
    e.target.value = ''
  }

  // 移动端使用抽屉式侧边栏；回到桌面端时恢复用户上次的折叠偏好。
  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < COLLAPSE_BREAKPOINT
      if (narrow === wasNarrow.current) return

      wasNarrow.current = narrow
      setSidebarCollapsed(
        narrow
          ? true
          : window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const nextCollapsed = !collapsed
      if (window.innerWidth >= COLLAPSE_BREAKPOINT) {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed))
      }
      return nextCollapsed
    })
  }, [])

  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed || window.innerWidth < COLLAPSE_BREAKPOINT) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth, currentWidth: sidebarWidth }
    setSidebarResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarCollapsed, sidebarWidth])

  const handleSidebarResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current
    if (!resize) return
    const nextWidth = clampSidebarWidth(resize.startWidth + event.clientX - resize.startX)
    resize.currentWidth = nextWidth
    setSidebarWidth(nextWidth)
  }, [])

  const finishSidebarResize = useCallback(() => {
    const resize = sidebarResizeRef.current
    if (resize) window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(resize.currentWidth))
    sidebarResizeRef.current = null
    setSidebarResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const handleSidebarResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setSidebarWidth((width) => {
      const nextWidth = clampSidebarWidth(width + (event.key === 'ArrowRight' ? 16 : -16))
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth))
      return nextWidth
    })
  }, [])

  if (loading) return <LoadingScreen />
  if (!user) return <LoginPage />

  return (
    <BrowserRouter>
      <div className="doco-app h-screen flex flex-col overflow-hidden">
        <header className="doco-app-header z-40 flex h-12 shrink-0 items-center px-4">
          <Link to="/" className="doco-wordmark-link" aria-label="Doco 首页">
            <DocoWordmark />
          </Link>
          <div className="ml-auto flex items-center text-sm text-gray-500">
            <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,.docx,.pdf" onChange={handleFileChange} className="hidden" />
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen(value => !value)}
                className="flex h-10 items-center gap-2 rounded-lg px-2 text-gray-600 transition-colors hover:bg-gray-100"
                title="账户菜单"
                aria-label="账户菜单"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-gray-200" />
                )}
                <span className="hidden max-w-[180px] truncate sm:inline">{user.name || user.email}</span>
                <ChevronDown size={14} />
              </button>
              {accountMenuOpen && (
                <div className="doco-menu absolute right-0 top-full z-50 mt-2 w-64 rounded-xl p-2 shadow-lg" role="menu" aria-label="账户菜单">
                  <p className="px-2 pb-2 pt-1 text-xs font-medium text-gray-400">外观</p>
                  {([
                    { value: 'simple', label: '冷感', description: '冷白蓝灰的现代编辑器风格' },
                    { value: 'paper', label: '纸感', description: '暖白陶土的纸张阅读风格' },
                  ] as const).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={appearanceTheme === option.value}
                      onClick={() => handleAppearanceChange(option.value)}
                      className={`doco-theme-option flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${appearanceTheme === option.value ? 'active' : ''}`}
                    >
                      <span className={`doco-theme-swatch ${option.value}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="mt-0.5 block text-xs text-gray-400">{option.description}</span>
                      </span>
                      {appearanceTheme === option.value && <Check size={15} className="mt-0.5 shrink-0" />}
                    </button>
                  ))}
                  <div className="mx-2 my-2 border-t border-gray-100" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setAccountMenuOpen(false); setApiTokenOpen(true) }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800"
                  >
                    <KeyRound size={16} />
                    API Token
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setAccountMenuOpen(false); setLogoutConfirmOpen(true) }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800"
                  >
                    <LogOut size={16} />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div
          className={`relative flex flex-1 overflow-hidden ${sidebarResizing ? 'is-sidebar-resizing' : ''}`}
          style={{ '--doco-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
        >
          <button
            type="button"
            aria-label="关闭侧边栏"
            aria-hidden={sidebarCollapsed}
            tabIndex={sidebarCollapsed ? -1 : 0}
            onClick={toggleSidebar}
            className={`absolute inset-0 z-20 bg-black/20 transition-opacity duration-200 md:hidden ${
              sidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
          />
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
            onDocRenamed={(docId, title) => setExternalTitle({ docId, title })}
            onActiveKnowledgeBaseChange={setActiveKnowledgeBaseTitle}
          />
          <div
            aria-hidden="true"
            className={`doco-sidebar-toggle-rail ${sidebarCollapsed ? 'is-visible' : ''}`}
          />
          <div
            role="separator"
            aria-label="调整侧边栏宽度"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            aria-hidden={sidebarCollapsed}
            tabIndex={sidebarCollapsed ? -1 : 0}
            className={`doco-sidebar-resizer ${sidebarCollapsed ? 'is-hidden' : ''}`}
            onPointerDown={handleSidebarResizeStart}
            onPointerMove={handleSidebarResizeMove}
            onPointerUp={finishSidebarResize}
            onPointerCancel={finishSidebarResize}
            onKeyDown={handleSidebarResizeKeyDown}
          />
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-controls="doco-sidebar"
            aria-expanded={!sidebarCollapsed}
            className={`doco-sidebar-edge-toggle ${sidebarCollapsed ? 'is-collapsed' : ''}`}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <span className={`doco-sidebar-toggle-triangle ${sidebarCollapsed ? 'points-right' : 'points-left'}`} />
          </button>
          <main className="doco-app-main min-w-0 flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<EditorPage exportRef={exportRef} externalTitle={externalTitle} user={user} onImportRequest={handleImport} onActiveDocumentTitleChange={setActiveDocumentTitle} />} />
              <Route path="/doc/:id" element={<EditorPage exportRef={exportRef} externalTitle={externalTitle} user={user} onImportRequest={handleImport} onActiveDocumentTitleChange={setActiveDocumentTitle} />} />
            </Routes>
          </main>
        </div>
        {logoutConfirmOpen && (
          <LogoutConfirmDialog
            onClose={() => setLogoutConfirmOpen(false)}
            onConfirm={signOut}
          />
        )}
        {apiTokenOpen && <ApiTokenDialog onClose={() => setApiTokenOpen(false)} />}
      </div>
    </BrowserRouter>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

export default App
