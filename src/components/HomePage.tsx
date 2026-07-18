import React, { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ArrowLeft, FileDown, FolderTree, LoaderCircle, Mail, MonitorSmartphone, Workflow } from 'lucide-react'
import { useAuth } from '../auth'
import { DocoLogo, DocoWordmark } from './DocoLogo'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

/** 邮箱验证码 + Google 登录面板，登录成功后由 HomePage 根据 user 状态跳转。 */
const LoginPanel = () => {
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
    <div
      id="login"
      className="w-full max-w-sm rounded-2xl border px-8 py-9 flex flex-col items-center text-center shadow-[0_8px_40px_rgba(0,0,0,0.06)]"
      style={{ background: 'var(--surface-elevated)', borderColor: 'var(--border-subtle, #e5e7eb)' }}
    >
      <h2 className="text-lg font-semibold text-gray-800 mb-1">登录 Doco</h2>
      <p className="text-sm text-gray-500 mb-7">使用邮箱或 Google 账号继续</p>

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
  )
}

const FEATURES = [
  { icon: MonitorSmartphone, title: '多端实时同步', desc: '基于 Yjs CRDT，手机电脑随时续写，编辑自动合并' },
  { icon: FolderTree, title: '知识库管理', desc: '知识库、文件夹、文档层级组织，随取随用' },
  { icon: Workflow, title: '图表与代码', desc: 'Mermaid、PlantUML、代码高亮，技术写作一步到位' },
  { icon: FileDown, title: '自由导入导出', desc: 'Markdown / Word / PDF 导入，单文档或整库导出' },
] as const

/** 落地首页：品牌展示 + 登录。已登录用户直接跳转工作区。 */
export const HomePage = () => {
  const { user } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  useEffect(() => {
    document.title = 'Doco · 知识库与写作空间'
  }, [])

  if (user) {
    return <Navigate to={from && from.startsWith('/app') ? from : '/app'} replace />
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-app)', color: 'var(--text-primary)' }}>
      <header className="flex h-16 shrink-0 items-center px-6 sm:px-10">
        <a href="/" aria-label="Doco 首页"><DocoWordmark /></a>
        <Link
          to="/api-docs"
          className="ml-auto mr-4 text-sm text-gray-500 transition hover:text-gray-900"
        >
          API 文档
        </Link>
        <a
          href="#login"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
        >
          登录
        </a>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <section>
            <div className="mb-6 flex items-center gap-4">
              <DocoLogo className="h-14 w-14" />
            </div>
            <h1 className="text-3xl font-bold leading-snug tracking-tight sm:text-4xl">
              你的知识库
              <br />
              与多端写作空间
            </h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-gray-500 sm:text-base">
              富文本编辑、多端实时同步、图表与代码块、Markdown 自由导出——
              把你的文档和知识沉淀在一处。
            </p>
            <ul className="mt-9 grid gap-5 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <li key={title} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}
                  >
                    <Icon size={17} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">{desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex justify-center lg:justify-end">
            <LoginPanel />
          </section>
        </div>
      </main>

      <footer className="shrink-0 px-6 pb-6 text-center text-xs text-gray-400 sm:px-10">
        多端实时同步 · 富文本编辑 · 数据本地优先
      </footer>
    </div>
  )
}
