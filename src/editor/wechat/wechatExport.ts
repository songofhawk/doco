import { marked } from 'marked'

import appleCss from './themes/apple.css?raw'
import blueCss from './themes/blue.css?raw'
import darkCss from './themes/dark.css?raw'
import defaultCss from './themes/default.css?raw'
import greenCss from './themes/green.css?raw'
import notionCss from './themes/notion.css?raw'
import vibrantCss from './themes/vibrant.css?raw'

export interface WechatTheme {
    id: string
    name: string
    css: string
}

export const WECHAT_THEMES: WechatTheme[] = [
    { id: 'default', name: '默认紫', css: defaultCss },
    { id: 'apple', name: 'Apple 风', css: appleCss },
    { id: 'blue', name: '蓝色', css: blueCss },
    { id: 'green', name: '绿色', css: greenCss },
    { id: 'notion', name: 'Notion 风', css: notionCss },
    { id: 'vibrant', name: '多彩', css: vibrantCss },
    { id: 'dark', name: '深色', css: darkCss },
]

/**
 * Markdown → 公众号兼容 HTML：
 * 1. marked 转 HTML
 * 2. 套 <section id="MdWechat"> 容器
 * 3. juice 把主题 CSS 全部内联（公众号只认 inline style）
 * 4. 展开 var(--xxx)（微信编辑器不支持 CSS 变量，会丢颜色）
 */
export async function renderWechatHtml(markdown: string, themeCss: string): Promise<string> {
    const html = marked.parse(markdown, { async: false })
    const wrapped = `<section id="MdWechat">${html}</section>`
    // juice 体积较大，按需加载，不进首屏 bundle
    const juice = (await import('juice')).default
    const inlined = juice.inlineContent(wrapped, themeCss)
    return expandCssVars(inlined, themeCss)
}

function expandCssVars(html: string, themeCss: string): string {
    const vars: Record<string, string> = {}
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g
    let m: RegExpExecArray | null
    while ((m = declRe.exec(themeCss))) {
        vars[m[1]] = m[2].trim()
    }
    return html.replace(/var\((--[\w-]+)\)/g, (raw, name) => vars[name] ?? raw)
}
