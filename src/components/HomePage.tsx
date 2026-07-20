import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, FileArchive, FileCode, FileDown, FileText, FileType, FileUp, LoaderCircle, Mail, Newspaper, X } from 'lucide-react'
import { useAuth } from '../auth'
import productEditorImage from '../assets/landing/product-editor.png'
import syncAbstractImage from '../assets/landing/sync-abstract.webp'
import { DocoWordmark } from './DocoLogo'
import './HomePage.css'

/** 邮箱验证码 + Google 登录面板，登录成功后由 HomePage 根据 user 状态跳转。 */
const LoginPanel = () => {
  const { googleClientId, signInWithGoogleCredential, requestEmailCode, signInWithEmailCode } = useAuth()
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
    if (!googleClientId) return

    let cancelled = false
    const renderButton = () => {
      if (cancelled || !buttonRef.current || !window.google) return
      buttonRef.current.innerHTML = ''
      window.google.accounts.id.initialize({
        client_id: googleClientId,
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
  }, [googleClientId, signInWithGoogleCredential])

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
    <div className="lp-login-card">
      <h2>登录 Doco</h2>
      <p>使用邮箱或 Google 账号继续</p>

      <form onSubmit={emailStep === 'email' ? (event) => { event.preventDefault(); void sendEmailCode() } : verifyEmailCode}>
        {emailStep === 'email' ? (
          <>
            <label htmlFor="login-email">邮箱地址</label>
            <div className="lp-login-field">
              <Mail size={16} />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                placeholder="name@example.com"
                className="lp-login-input"
              />
            </div>
            <button type="submit" disabled={submitting} className="lp-login-submit">
              {submitting && <LoaderCircle size={15} className="animate-spin" />}
              发送验证码
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setEmailStep('email'); setCode(''); setError('') }}
              className="lp-login-back"
            >
              <ArrowLeft size={13} /> 更换邮箱
            </button>
            <label htmlFor="login-code">输入 6 位验证码</label>
            <p className="lp-login-hint">验证码已发送至 {email}</p>
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
              className="lp-login-input lp-login-input--code"
            />
            <button type="submit" disabled={submitting || code.length !== 6} className="lp-login-submit">
              {submitting && <LoaderCircle size={15} className="animate-spin" />}
              登录
            </button>
            <button
              type="button"
              disabled={submitting || cooldown > 0}
              onClick={() => void sendEmailCode()}
              className="lp-login-resend"
            >
              {cooldown > 0 ? `${cooldown} 秒后可重新发送` : '重新发送验证码'}
            </button>
          </>
        )}
      </form>

      {googleClientId && (
        <>
          <div className="lp-login-divider">或</div>
          <div ref={buttonRef} className="lp-login-google" />
        </>
      )}
      {error && <p className="lp-login-error">{error}</p>}
    </div>
  )
}

const FEATURES: ReadonlyArray<{ index: string; title: string; desc: string; href?: string; login?: boolean }> = [
  { index: '01', title: '多端实时同步', desc: '基于 Yjs CRDT，手机电脑随时续写，编辑自动合并', href: '#sync' },
  { index: '02', title: '知识库管理', desc: '知识库、文件夹、文档层级组织，随取随用', login: true },
  { index: '03', title: '图表与代码', desc: 'Mermaid、PlantUML、代码高亮，技术写作一步到位', href: '#create' },
  { index: '04', title: '自由导入导出', desc: 'Markdown / Word / PDF 导入，单文档或整库导出', href: '#io' },
]

const STEPS = [
  { index: 'Ⅰ', title: '本地优先', desc: '所有更改先写入浏览器本地存储，离线也能完整编辑，打开即用。' },
  { index: 'Ⅱ', title: '增量同步', desc: '联网后仅交换 Yjs 二进制增量，同步轻量、迅速，不争抢你的注意力。' },
  { index: 'Ⅲ', title: '自动合并', desc: 'CRDT 算法在后台消解多端冲突，你只管书写，历史永不丢失。' },
] as const

/** 真实产品画面：保留轻量窗口语义，让截图自然融入杂志式版面。 */
const ProductMedia = ({
  src,
  alt,
  label,
  parallax,
}: {
  src: string
  alt: string
  label: string
  parallax?: number
}) => (
  <figure className="lp-product-media" data-reveal data-parallax={parallax}>
    <figcaption className="lp-product-media-bar">
      <span className="lp-product-media-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
      <span className="lp-product-media-live" aria-hidden="true">Live</span>
    </figcaption>
    <img src={src} alt={alt} loading="lazy" decoding="async" />
  </figure>
)

/** 图表与代码示意：左 Mermaid 源码、右渲染成品，复用产品窗口样式。 */
const CodeDiagramMedia = ({ parallax }: { parallax?: number }) => (
  <figure className="lp-product-media" data-reveal data-parallax={parallax}>
    <figcaption className="lp-product-media-bar">
      <span className="lp-product-media-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>flow.md</span>
      <span className="lp-product-media-live" aria-hidden="true">Mermaid</span>
    </figcaption>
    <div className="lp-code-mock">
      <pre className="lp-code-mock-src" aria-hidden="true"><code>{''}
<span className="c-kw">flowchart</span> LR{'\n'}
{'  '}灵感 <span className="c-arrow">--&gt;</span> 写作{'\n'}
{'  '}写作 <span className="c-arrow">--&gt;</span> 发布{'\n'}
{'  '}发布 <span className="c-arrow">-.-&gt;</span> <span className="c-node">灵感</span>
      </code></pre>
      <div className="lp-code-mock-diagram">
        <svg viewBox="0 0 320 92" role="img" aria-label="流程图：灵感、写作、发布循环">
          <defs>
            <marker id="lp-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#98a1b0" />
            </marker>
          </defs>
          <line x1="82" y1="38" x2="116" y2="38" stroke="#98a1b0" markerEnd="url(#lp-arrow)" />
          <line x1="194" y1="38" x2="228" y2="38" stroke="#98a1b0" markerEnd="url(#lp-arrow)" />
          <path d="M 268 62 C 268 84, 44 84, 44 62" fill="none" stroke="#98a1b0" strokeDasharray="4 4" markerEnd="url(#lp-arrow)" />
          <rect x="10" y="20" width="72" height="36" rx="8" fill="#ffffff" stroke="#b9552f" />
          <rect x="122" y="20" width="72" height="36" rx="8" fill="#ffffff" stroke="#b9552f" />
          <rect x="234" y="20" width="72" height="36" rx="8" fill="#fbe9e0" stroke="#b9552f" />
          <text x="46" y="43" textAnchor="middle" fontSize="12" fill="#111827">灵感</text>
          <text x="158" y="43" textAnchor="middle" fontSize="12" fill="#111827">写作</text>
          <text x="270" y="43" textAnchor="middle" fontSize="12" fill="#111827">发布</text>
        </svg>
      </div>
    </div>
  </figure>
)

/** 背景幽灵大字：以独立速率随滚动漂移，衬托前景内容的浮动感。 */
const GhostWord = ({ word, speed, style }: { word: string; speed: number; style?: React.CSSProperties }) => (
  <span className="lp-ghost" data-parallax={speed} style={style} aria-hidden="true">{word}</span>
)

/** 落地首页：奢侈品宣传页风格。登录为点击弹出的模态框；
 *  已登录用户可自由浏览首页（入口变为「进入工作区」），
 *  仅当从 /app 被拦截回跳而来时，登录成功后自动续走来源页。 */
export const HomePage = () => {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: string } | null)?.from
  const [scrolled, setScrolled] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  // 登录成功后：关闭弹窗并进入工作区（或被拦截前的来源页）
  useEffect(() => {
    if (!user || !loginOpen) return
    setLoginOpen(false)
    navigate(from && from.startsWith('/app') ? from : '/app', { replace: true })
  }, [user, loginOpen, from, navigate])

  // 登录弹窗：Esc 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!loginOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [loginOpen])

  useEffect(() => {
    document.title = 'Doco · 知识库与写作空间'

    // 锚点平滑滚动仅在本页生效，卸载时还原，避免影响应用内滚动
    const root = document.documentElement
    const previousScrollBehavior = root.style.scrollBehavior
    root.style.scrollBehavior = 'smooth'

    // 滚动视差：data-parallax 元素按各自速率随滚动漂移，
    // 文字、图片与背景大字形成微小的不同步（写在 translate 属性上，
    // 与 data-reveal 的 transform 过渡互不干扰）
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const parallaxItems = reduceMotion
      ? []
      : Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'))
    let raf = 0
    const updateParallax = () => {
      raf = 0
      const viewportCenter = window.innerHeight / 2
      for (const el of parallaxItems) {
        const speed = Number.parseFloat(el.dataset.parallax || '0')
        const rect = el.getBoundingClientRect()
        const distance = rect.top + rect.height / 2 - viewportCenter
        el.style.translate = `0 ${(-distance * speed).toFixed(1)}px`
      }
    }
    const requestParallax = () => {
      if (!raf) raf = requestAnimationFrame(updateParallax)
    }

    const onScroll = () => {
      setScrolled(window.scrollY > 24)
      requestParallax()
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', requestParallax)

    // 滚动浮现：进入视口的元素加 .is-visible，只触发一次
    const items = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.14 },
    )
    items.forEach((item) => observer.observe(item))

    return () => {
      root.style.scrollBehavior = previousScrollBehavior
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', requestParallax)
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  // 仅当从 /app 被拦截回跳而来且已登录时直接续走；其余情况首页可自由浏览
  if (user && from && from.startsWith('/app')) {
    return <Navigate to={from} replace />
  }

  return (
    <div className="landing">
      <header className={`lp-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="lp-container lp-header-inner">
          <a href="#top" className="lp-header-brand" aria-label="Doco 首页"><DocoWordmark /></a>
          <nav className="lp-nav">
            <a className="lp-nav-link" href="#features">特性</a>
            <a className="lp-nav-link" href="#sync">协同</a>
            <a className="lp-nav-link" href="#data">数据</a>
            <a className="lp-nav-link" href="/api-docs" target="_blank" rel="noreferrer">API 文档</a>
            {user ? (
              <Link className="lp-button" to="/app">进入工作区</Link>
            ) : (
              <button type="button" className="lp-button" onClick={() => setLoginOpen(true)}>登录</button>
            )}
          </nav>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="lp-hero">
          <GhostWord word="Doco" speed={-0.06} style={{ left: '-3%', bottom: '-10%' }} />
          <div className="lp-container lp-hero-grid">
            <div data-parallax={0.03}>
              <span className="lp-eyebrow" data-reveal>Doco — 知识库与写作空间</span>
              <h1 className="lp-display lp-hero-title" data-reveal style={{ transitionDelay: '80ms' }}>
                为思想
                <br />
                造一间<em>书房</em>
              </h1>
              <p className="lp-lead lp-hero-lead" data-reveal style={{ transitionDelay: '160ms' }}>
                富文本编辑、多端实时同步、图表与代码、Markdown 自由导出——
                Doco 把你的文档与知识，安静地沉淀在一处。
              </p>
              <div className="lp-hero-actions" data-reveal style={{ transitionDelay: '240ms' }}>
                {user ? (
                  <Link className="lp-button" to="/app">进入工作区</Link>
                ) : (
                  <button type="button" className="lp-button" onClick={() => setLoginOpen(true)}>开始写作</button>
                )}
                <a className="lp-button lp-button--ghost" href="#features">了解特性</a>
              </div>
              <div className="lp-hero-meta" data-reveal style={{ transitionDelay: '320ms' }}>
                <div className="lp-hero-meta-item"><strong>本地优先</strong>Local First</div>
                <div className="lp-hero-meta-item"><strong>实时协同</strong>Yjs · CRDT</div>
                <div className="lp-hero-meta-item"><strong>自由导出</strong>Markdown</div>
              </div>
            </div>

            <div className="lp-hero-visual" data-reveal data-parallax={0.09} style={{ transitionDelay: '200ms' }} aria-hidden="true">
              <div className="lp-visual-glow" />
              <div className="lp-orbit" />
              <div className="lp-orbit lp-orbit--inner" />
              <div className="lp-doc-card lp-doc-card--back" />
              <div className="lp-doc-card" />
              <span className="lp-visual-caption">Est. MMXXVI</span>
            </div>
          </div>
        </section>

        {/* 宣言 */}
        <section className="lp-statement">
          <GhostWord word="Write" speed={0.1} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          <div className="lp-container">
            <blockquote className="lp-display lp-statement-quote" data-reveal data-parallax={0.04}>
              「工具应当隐去，
              <br />
              只留下你与<em>文字</em>。」
            </blockquote>
            <p className="lp-statement-note" data-reveal style={{ transitionDelay: '120ms' }}>Doco 的设计信条</p>
          </div>
        </section>

        {/* 特性 */}
        <section className="lp-section" id="features">
          <GhostWord word="Archive" speed={0.08} style={{ right: '-4%', top: '2%' }} />
          <div className="lp-container">
            <div className="lp-section-head" data-parallax={0.03}>
              <div>
                <span className="lp-eyebrow" data-reveal>Capabilities</span>
                <h2 className="lp-display lp-section-title" data-reveal style={{ transitionDelay: '80ms' }}>
                  一间书房的<em>全部陈设</em>
                </h2>
              </div>
              <p className="lp-section-aside" data-reveal style={{ transitionDelay: '160ms' }}>
                从灵感到成稿，从个人笔记到团队知识库——每一件器物都为长文写作而打磨。
              </p>
            </div>
            <div>
              {FEATURES.map((feature, i) => (
                <a
                  className="lp-feature-row"
                  key={feature.index}
                  href={feature.login ? '#login' : feature.href}
                  onClick={feature.login ? (event) => {
                    event.preventDefault()
                    if (user) navigate('/app')
                    else setLoginOpen(true)
                  } : undefined}
                  data-reveal
                  style={{ transitionDelay: `${i * 80}ms` }}
                >
                  <span className="lp-feature-index">{feature.index}</span>
                  <div className="lp-feature-name">
                    <h3>{feature.title}</h3>
                    <p>{feature.desc}</p>
                  </div>
                  <span className="lp-feature-arrow"><ArrowUpRight size={15} /></span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* 图表与代码 */}
        <section className="lp-section" id="create">
          <GhostWord word="Draft" speed={0.08} style={{ left: '-3%', bottom: '4%' }} />
          <div className="lp-container lp-editorial">
            <div data-parallax={0.03}>
              <span className="lp-eyebrow" data-reveal>Expression</span>
              <h2 className="lp-display lp-section-title" data-reveal style={{ transitionDelay: '80ms' }}>
                图表与代码，<br />信手<em>拈来</em>
              </h2>
              <ul className="lp-editorial-list">
                <li data-reveal style={{ transitionDelay: '140ms' }}>Mermaid 围栏代码一键成图，流程图、时序图随手画</li>
                <li data-reveal style={{ transitionDelay: '220ms' }}>PlantUML 架构图原生支持，设计文档图文并茂</li>
                <li data-reveal style={{ transitionDelay: '300ms' }}>代码块语法高亮，技术写作无需离开编辑器</li>
              </ul>
            </div>
            <CodeDiagramMedia parallax={0.09} />
          </div>
        </section>

        {/* 协同（深色） */}
        <section className="lp-section lp-dark" id="sync">
          <GhostWord word="Sync" speed={-0.07} style={{ left: '-2%', bottom: '4%' }} />
          <div className="lp-container">
            <span className="lp-eyebrow" data-reveal>Synchronisation</span>
            <h2 className="lp-display lp-section-title" data-reveal data-parallax={0.03} style={{ transitionDelay: '80ms' }}>
              多端同步，<br />如<em>呼吸</em>般自然
            </h2>
            <div className="lp-steps">
              {STEPS.map((step, i) => (
                <div className="lp-step" key={step.index} data-reveal data-parallax={0.05} style={{ transitionDelay: `${i * 110}ms` }}>
                  <span className="lp-step-index">{step.index}</span>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '4.5rem' }}>
              <ProductMedia
                src={syncAbstractImage}
                alt="三张由陶土色墨带相连的纸张，抽象表达同一份内容在多端保持同步"
                label="同步发生于无形"
                parallax={0.1}
              />
            </div>
          </div>
        </section>

        {/* 导入导出 */}
        <section className="lp-section lp-section--stone" id="io">
          <GhostWord word="Flow" speed={0.08} style={{ right: '-3%', top: '4%' }} />
          <div className="lp-container">
            <div className="lp-section-head" data-parallax={0.03}>
              <div>
                <span className="lp-eyebrow" data-reveal>Import &amp; Export</span>
                <h2 className="lp-display lp-section-title" data-reveal style={{ transitionDelay: '80ms' }}>
                  自由<em>导入导出</em>
                </h2>
              </div>
              <p className="lp-section-aside" data-reveal style={{ transitionDelay: '160ms' }}>
                迁入无门槛，离开无羁绊——文档以开放格式存在，随时来去自由。
              </p>
            </div>
            <div className="lp-io-grid">
              <div className="lp-io-card" data-reveal data-parallax={0.04}>
                <div className="lp-io-card-head"><FileUp size={14} /> 导入</div>
                <ul>
                  <li data-reveal style={{ transitionDelay: '80ms' }}><FileCode size={15} /><span>Markdown</span><em>.md 直接拖入</em></li>
                  <li data-reveal style={{ transitionDelay: '160ms' }}><FileType size={15} /><span>Word</span><em>.docx 保留排版</em></li>
                  <li data-reveal style={{ transitionDelay: '240ms' }}><FileText size={15} /><span>PDF</span><em>提取正文成稿</em></li>
                </ul>
              </div>
              <div className="lp-io-card" data-reveal data-parallax={0.06} style={{ transitionDelay: '120ms' }}>
                <div className="lp-io-card-head"><FileDown size={14} /> 导出</div>
                <ul>
                  <li data-reveal style={{ transitionDelay: '200ms' }}><FileCode size={15} /><span>Markdown</span><em>单文档实时导出</em></li>
                  <li data-reveal style={{ transitionDelay: '280ms' }}><FileArchive size={15} /><span>ZIP</span><em>整库或文件夹打包</em></li>
                  <li data-reveal style={{ transitionDelay: '360ms' }}><Newspaper size={15} /><span>HTML</span><em>内联样式直接粘贴</em></li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* 数据 */}
        <section className="lp-section" id="data">
          <GhostWord word="Data" speed={0.08} style={{ right: '-3%', bottom: '6%' }} />
          <div className="lp-container lp-editorial">
            <div data-parallax={0.03}>
              <span className="lp-eyebrow" data-reveal>Data Ownership</span>
              <h2 className="lp-display lp-section-title" data-reveal style={{ transitionDelay: '80ms' }}>
                你的数据，<br />始终<em>属于你</em>
              </h2>
              <ul className="lp-editorial-list">
                <li data-reveal style={{ transitionDelay: '140ms' }}>文档本地优先存储，服务器只是你的同步与备份端</li>
                <li data-reveal style={{ transitionDelay: '220ms' }}>单文档导出 Markdown，整个知识库打包 ZIP，随时带走</li>
                <li data-reveal style={{ transitionDelay: '300ms' }}>开放 REST API，用脚本自由读写你的每一篇文档</li>
              </ul>
              <div data-reveal style={{ transitionDelay: '380ms', marginTop: '2.4rem' }}>
                <a className="lp-button lp-button--ghost" href="/api-docs" target="_blank" rel="noreferrer">
                  查看 API 文档 <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
            <ProductMedia
              src={productEditorImage}
              alt="Doco 产品界面，左侧为知识库目录，右侧文档包含任务清单与从灵感到发布的流程图"
              label="真实界面 · 文档、知识库与开放能力"
              parallax={0.09}
            />
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-top">
            <p className="lp-footer-slogan" style={{ margin: 0 }}>书写，值得被认真对待。</p>
            <div className="lp-footer-links">
              <a href="#features">特性</a>
              <a href="#sync">协同</a>
              <a href="#data">数据</a>
              <a href="/api-docs" target="_blank" rel="noreferrer">API 文档</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© MMXXVI Doco</span>
            <span>多端实时同步 · 富文本编辑 · 数据本地优先</span>
          </div>
        </div>
      </footer>

      {loginOpen && createPortal(
        <div className="lp-login-overlay" onClick={() => setLoginOpen(false)}>
          <div
            className="lp-login-modal"
            role="dialog"
            aria-modal="true"
            aria-label="登录 Doco"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="lp-login-close" onClick={() => setLoginOpen(false)} aria-label="关闭">
              <X size={16} />
            </button>
            <LoginPanel />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
