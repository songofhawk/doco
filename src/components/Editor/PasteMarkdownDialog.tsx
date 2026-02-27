import { useState, useEffect, useCallback } from 'react'

/**
 * 检测文本是否包含 Markdown 格式特征
 * 通过匹配常见 Markdown 语法来判断
 */
export function detectMarkdown(text: string): boolean {
    if (!text || text.trim().length === 0) return false

    const lines = text.split('\n')
    let score = 0

    for (const line of lines) {
        const trimmed = line.trim()
        // 标题 # ## ###
        if (/^#{1,6}\s+\S/.test(trimmed)) { score += 3; continue }
        // 无序列表 - * +
        if (/^[-*+]\s+\S/.test(trimmed)) { score += 1; continue }
        // 有序列表
        if (/^\d+\.\s+\S/.test(trimmed)) { score += 1; continue }
        // 代码块 ```
        if (/^```/.test(trimmed)) { score += 3; continue }
        // 引用 >
        if (/^>\s/.test(trimmed)) { score += 2; continue }
        // 粗体 **text** 或 __text__
        if (/\*\*[^*]+\*\*/.test(trimmed) || /__[^_]+__/.test(trimmed)) { score += 2; continue }
        // 链接 [text](url)
        if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) { score += 2; continue }
        // 图片 ![alt](url)
        if (/!\[[^\]]*\]\([^)]+\)/.test(trimmed)) { score += 2; continue }
        // 分割线 --- ***
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { score += 2; continue }
        // 任务列表 - [ ] / - [x]
        if (/^[-*]\s+\[[ x]\]\s/.test(trimmed)) { score += 2; continue }
        // 表格 |---|
        if (/\|.*\|/.test(trimmed) && /[-:]+/.test(trimmed)) { score += 2; continue }
    }

    // 至少达到 3 分才认为是 Markdown
    return score >= 3
}

interface PasteDialogState {
    visible: boolean
    text: string
    resolve: ((asRichText: boolean) => void) | null
}

/**
 * Hook：管理粘贴 Markdown 弹窗状态
 */
export function usePasteMarkdownDialog() {
    const [state, setState] = useState<PasteDialogState>({
        visible: false, text: '', resolve: null,
    })

    const prompt = useCallback((text: string): Promise<boolean> => {
        return new Promise((resolve) => {
            setState({ visible: true, text, resolve })
        })
    }, [])

    const handleChoice = useCallback((asRichText: boolean) => {
        state.resolve?.(asRichText)
        setState({ visible: false, text: '', resolve: null })
    }, [state.resolve])

    return { state, prompt, handleChoice }
}

/**
 * 粘贴 Markdown 提示弹窗
 */
export function PasteMarkdownDialog({ visible, text, onChoice }: {
    visible: boolean
    text: string
    onChoice: (asRichText: boolean) => void
}) {
    // ESC 关闭（作为纯文本粘贴）
    useEffect(() => {
        if (!visible) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onChoice(false)
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [visible, onChoice])

    if (!visible) return null

    // 截取预览前 3 行
    const preview = text.split('\n').slice(0, 3).join('\n')
    const hasMore = text.split('\n').length > 3

    return (
        <div className="paste-md-dialog-overlay" onClick={() => onChoice(false)}>
            <div className="paste-md-dialog" onClick={e => e.stopPropagation()}>
                <div className="paste-md-dialog-title">
                    检测到 Markdown 格式
                </div>
                <div className="paste-md-dialog-preview">
                    <code>{preview}{hasMore ? '\n...' : ''}</code>
                </div>
                <div className="paste-md-dialog-actions">
                    <button
                        className="paste-md-btn paste-md-btn-primary"
                        onClick={() => onChoice(true)}
                    >
                        转换为正文
                    </button>
                    <button
                        className="paste-md-btn paste-md-btn-secondary"
                        onClick={() => onChoice(false)}
                    >
                        以代码块插入
                    </button>
                </div>
            </div>
        </div>
    )
}
