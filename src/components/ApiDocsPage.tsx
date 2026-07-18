import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Braces, Copy, ExternalLink, FileText } from 'lucide-react'
import { marked, type Tokens } from 'marked'
import { Link } from 'react-router-dom'
import { API_BASE } from '../auth'
import { DocoWordmark } from './DocoLogo'

const MARKDOWN_URL = '/api-docs.md'

function headingSlug(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'section'
}

function uniqueHeadingSlug(text: string, counts: Map<string, number>) {
  const base = headingSlug(text)
  const count = counts.get(base) || 0
  counts.set(base, count + 1)
  return count ? `${base}-${count + 1}` : base
}

export function ApiDocsPage() {
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeHeading, setActiveHeading] = useState('')
  const articleRef = useRef<HTMLElement>(null)
  const openApiUrl = useMemo(() => {
    const apiOrigin = new URL(API_BASE, window.location.origin).origin
    return new URL('/api/openapi.json', apiOrigin).toString()
  }, [])

  useEffect(() => {
    document.title = 'Doco 开放 API 文档'
    const alternate = document.createElement('link')
    alternate.rel = 'alternate'
    alternate.type = 'text/markdown'
    alternate.href = MARKDOWN_URL
    document.head.appendChild(alternate)

    const controller = new AbortController()
    fetch(MARKDOWN_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`文档加载失败（${response.status}）`)
        return response.text()
      })
      .then(setMarkdown)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '文档加载失败')
      })

    return () => {
      controller.abort()
      alternate.remove()
    }
  }, [])

  const rendered = useMemo(() => marked.parse(markdown, { gfm: true, breaks: false }) as string, [markdown])
  const toc = useMemo(() => {
    const counts = new Map<string, number>()
    return marked.lexer(markdown)
      .filter((token): token is Tokens.Heading => token.type === 'heading' && (token.depth === 2 || token.depth === 3))
      .map((token) => ({ depth: token.depth, text: token.text, id: uniqueHeadingSlug(token.text, counts) }))
  }, [markdown])

  useEffect(() => {
    const headings = articleRef.current?.querySelectorAll<HTMLElement>('h2, h3')
    if (!headings?.length) return

    const counts = new Map<string, number>()
    headings.forEach((heading) => { heading.id = uniqueHeadingSlug(heading.textContent || '', counts) })
    setActiveHeading(window.location.hash.slice(1) || headings[0].id)

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting)
      if (visible?.target.id) setActiveHeading(visible.target.id)
    }, { rootMargin: '-80px 0px -70% 0px' })
    headings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [rendered])

  const copyMarkdownUrl = async () => {
    await navigator.clipboard.writeText(new URL(MARKDOWN_URL, window.location.origin).toString())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="api-docs-page min-h-screen">
      <header className="api-docs-header sticky top-0 z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <Link to="/" className="doco-wordmark-link" aria-label="返回 Doco 首页">
            <DocoWordmark />
          </Link>
          <span className="api-docs-header-divider" aria-hidden="true" />
          <span className="text-sm text-[var(--text-secondary)]">开放 API v1</span>
          <nav className="ml-auto flex items-center gap-2" aria-label="API 文档资源">
            <button
              type="button"
              onClick={copyMarkdownUrl}
              className="api-docs-secondary-button hidden sm:inline-flex"
              title="复制 Markdown 原文地址"
            >
              <Copy size={15} />
              {copied ? '已复制' : '复制原文地址'}
            </button>
            <a href={MARKDOWN_URL} className="api-docs-primary-button" type="text/markdown">
              <FileText size={15} />
              Markdown 原文
            </a>
          </nav>
        </div>
      </header>

      <main className="api-docs-layout mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        {markdown && (
          <aside className="api-docs-toc" aria-label="文档目录">
            <div className="api-docs-toc-inner">
              <p className="api-docs-toc-title">本页目录</p>
              <nav>
                {toc.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={`${item.depth === 3 ? 'is-nested' : ''} ${activeHeading === item.id ? 'is-active' : ''}`}
                    onClick={() => setActiveHeading(item.id)}
                  >
                    {item.text}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        )}

        <div className="min-w-0">
          <section className="api-docs-resources" aria-label="开发者资源">
            <div>
              <p className="api-docs-resources-title">开发者资源</p>
              <p>供 Agent 与接口工具直接读取的机器契约。</p>
            </div>
            <div className="api-docs-resources-actions">
              <a
                href={openApiUrl}
                target="_blank"
                rel="noreferrer"
                className="api-docs-secondary-button"
                title="在新标签页打开供 Agent 和工具读取的 OpenAPI JSON"
              >
                <Braces size={16} /> OpenAPI 3.1 JSON <ExternalLink size={13} />
              </a>
              <Link to="/" className="api-docs-text-link">
                <ArrowLeft size={15} /> 返回 Doco
              </Link>
            </div>
          </section>

          {error ? (
            <div role="alert" className="api-docs-state api-docs-error">
              <h2>无法载入 API 文档</h2>
              <p>{error}</p>
              <a href={MARKDOWN_URL}>直接打开 Markdown 原文</a>
            </div>
          ) : markdown ? (
            <article
              ref={articleRef}
              className="api-docs-content"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          ) : (
            <div className="api-docs-state" role="status">正在载入 API 文档…</div>
          )}
        </div>
      </main>
    </div>
  )
}
