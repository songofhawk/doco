import { useEffect, useState, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { List } from 'lucide-react'

interface TocItem {
  id: string
  level: number
  text: string
  pos: number
}

export function TableOfContents({ editor, headingNumbered }: { editor: Editor; headingNumbered: boolean }) {
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [cardLeft, setCardLeft] = useState<number | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>()

  const handleMouseEnter = () => {
    clearTimeout(collapseTimer.current)
    setExpanded(true)
  }

  const handleMouseLeave = () => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 300)
  }

  // 动态跟踪编辑器卡片左边缘位置
  useEffect(() => {
    const updatePos = () => {
      const card = editor.view.dom.closest('.max-w-4xl') as HTMLElement | null
      if (card) setCardLeft(card.getBoundingClientRect().left)
    }
    updatePos()
    const main = document.querySelector('main')
    window.addEventListener('resize', updatePos)
    main?.addEventListener('scroll', updatePos, { passive: true })
    return () => {
      window.removeEventListener('resize', updatePos)
      main?.removeEventListener('scroll', updatePos)
    }
  }, [editor])

  // 提取标题
  const extractHeadings = useCallback(() => {
    const headings: TocItem[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        headings.push({ id: `heading-${pos}`, level: node.attrs.level as number, text: node.textContent, pos })
      }
    })
    setItems(headings)
  }, [editor])

  useEffect(() => {
    extractHeadings()
    editor.on('update', extractHeadings)
    return () => { editor.off('update', extractHeadings) }
  }, [editor, extractHeadings])

  // 滚动监听：高亮当前可见标题
  useEffect(() => {
    const scrollContainer = document.querySelector('main')
    if (!scrollContainer || items.length === 0) return

    const handleScroll = () => {
      const headingEls: { id: string; top: number }[] = []
      items.forEach((item) => {
        try {
          const domPos = editor.view.domAtPos(item.pos + 1)
          const el = domPos.node instanceof HTMLElement ? domPos.node : domPos.node.parentElement
          if (el) {
            const heading = el.closest('h1, h2, h3, h4') || el
            headingEls.push({ id: item.id, top: heading.getBoundingClientRect().top })
          }
        } catch { /* pos 可能已失效 */ }
      })

      const scrollOffset = 100
      let current: string | null = null
      for (const h of headingEls) {
        if (h.top <= scrollOffset) current = h.id
      }
      if (!current && headingEls.length > 0) current = headingEls[0].id
      setActiveId(current)
    }

    handleScroll()
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [editor, items])

  // 点击跳转
  const scrollToHeading = (item: TocItem) => {
    try {
      const domPos = editor.view.domAtPos(item.pos + 1)
      const el = domPos.node instanceof HTMLElement ? domPos.node : domPos.node.parentElement
      if (el) {
        const heading = el.closest('h1, h2, h3, h4') || el
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch { /* pos 可能已失效 */ }
  }

  // 左侧空间不足时隐藏（触发按钮 36px + 间距）
  if (items.length === 0 || cardLeft === null || cardLeft < 56) {
    return null
  }

  // 计算多级编号（自动适配最小标题级别）
  const minLevel = items.length > 0 ? Math.min(...items.map(i => i.level)) : 1
  const getNumbering = (index: number): string => {
    if (!headingNumbered) return ''
    const depth = 4
    const counters = new Array(depth).fill(0)
    for (let i = 0; i <= index; i++) {
      const lvl = items[i].level - minLevel // 归一化：最小级别 → 0
      counters[lvl]++
      for (let j = lvl + 1; j < depth; j++) counters[j] = 0
    }
    const cur = items[index].level - minLevel
    return counters.slice(0, cur + 1).join('.') + ' '
  }

  const indent: Record<number, string> = {
    1: 'pl-0',
    2: 'pl-3',
    3: 'pl-6',
    4: 'pl-9',
  }

  // 触发按钮紧贴卡片左侧外面
  const triggerLeft = cardLeft - 36 - 8
  // 面板宽度自适应：不超过可用空间
  const panelWidth = Math.min(220, cardLeft - 16)

  return (
    <aside
      className="toc-aside"
      style={{ left: triggerLeft }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 收起态：图标按钮 */}
      <div className={`toc-trigger ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <List size={18} className="text-gray-400" />
      </div>

      {/* 展开态：面板右边缘对齐触发按钮右边缘 */}
      <nav
        className={`toc-panel ${expanded ? 'toc-panel-visible' : ''}`}
        style={{ width: panelWidth, right: 0 }}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 px-2">
          <List size={14} />
          <span>目录</span>
        </div>
        <ul className="space-y-0.5">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                onClick={() => scrollToHeading(item)}
                className={`
                  toc-item w-full text-left text-sm truncate
                  rounded-md px-2 py-1 transition-colors
                  ${indent[item.level] || 'pl-0'}
                  ${activeId === item.id
                    ? 'text-blue-600 bg-blue-50 font-medium'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}
                `}
                title={item.text}
              >
                {headingNumbered && (
                  <span className="text-gray-400 mr-1">{getNumbering(index)}</span>
                )}
                {item.text || '(空标题)'}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
