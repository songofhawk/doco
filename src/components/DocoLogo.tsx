import type { SVGProps } from 'react'

type DocoLogoProps = SVGProps<SVGSVGElement> & {
  framed?: boolean
  title?: string
}

const DocoGlyph = () => (
  <>
    <path
      d="M15 12.5h9.25C32.4 12.5 38 17.2 38 24s-5.6 11.5-13.75 11.5H15v-23Z"
      stroke="var(--logo-accent, #c96442)"
      strokeWidth="4.25"
      strokeLinejoin="round"
    />
    <path
      d="M28.5 12.8v7.7h8.2"
      stroke="var(--logo-olive, #74785c)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="28.5" cy="28" r="2" fill="var(--logo-olive, #74785c)" />
  </>
)

/**
 * Doco 的品牌图形：纸张轮廓与字母 D 共用一条笔画，
 * 陶土色折角代表内容从文档中生长出来。该 D 同时用于缩写标志和完整字标。
 */
export function DocoLogo({ framed = true, title, ...props }: DocoLogoProps) {
  return (
    <svg
      viewBox={framed ? '0 0 48 48' : '9 9 32 32'}
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title && <title>{title}</title>}
      {framed && (
        <rect
          x="1"
          y="1"
          width="46"
          height="46"
          rx="13"
          fill="var(--logo-surface, #f5f1e8)"
          stroke="var(--logo-border, #ded7ca)"
          strokeWidth="2"
        />
      )}
      <DocoGlyph />
    </svg>
  )
}

type DocoWordmarkProps = SVGProps<SVGSVGElement>

/** 完整品牌字标：D 与 oco 固定在同一个 SVG 坐标系内。 */
export function DocoWordmark({ className, ...props }: DocoWordmarkProps) {
  return (
    <svg
      viewBox="9 9 86 32"
      width="86"
      height="32"
      fill="none"
      aria-label="Doco"
      role="img"
      className={['doco-wordmark', className].filter(Boolean).join(' ')}
      {...props}
    >
      <title>Doco</title>
      <DocoGlyph />
      <text x="45" y="36" className="doco-wordmark-letters">oco</text>
    </svg>
  )
}
