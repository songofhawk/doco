export type EditorShortcutId =
    | 'paragraph' | 'heading1' | 'heading2' | 'heading3'
    | 'bulletList' | 'orderedList' | 'taskList'
    | 'blockquote' | 'codeBlock' | 'calloutBlock' | 'horizontalRule'
    | 'bold' | 'italic' | 'underline' | 'strike' | 'inlineCode' | 'highlight' | 'link'
    | 'alignLeft' | 'alignCenter' | 'alignRight'
    | 'cut' | 'copy' | 'copyAsText' | 'copyAsMarkdown'
    | 'duplicate' | 'moveUp' | 'moveDown' | 'addBelow' | 'collapse' | 'delete'

/**
 * Tiptap/ProseMirror 使用 Mod 表示 macOS 的 Command，以及 Windows/Linux 的 Ctrl。
 * UI 只保存这一份定义，菜单文案和实际快捷键由此保持同步。
 */
export const EDITOR_SHORTCUTS: Record<EditorShortcutId, string> = {
    paragraph: 'Mod-Alt-0',
    heading1: 'Mod-Alt-1',
    heading2: 'Mod-Alt-2',
    heading3: 'Mod-Alt-3',
    bulletList: 'Mod-Shift-8',
    orderedList: 'Mod-Shift-7',
    taskList: 'Mod-Shift-9',
    blockquote: 'Mod-Alt-q',
    codeBlock: 'Mod-Alt-c',
    calloutBlock: 'Mod-Alt-h',
    horizontalRule: 'Mod-Alt--',
    bold: 'Mod-b',
    italic: 'Mod-i',
    underline: 'Mod-u',
    strike: 'Mod-Shift-x',
    inlineCode: 'Mod-e',
    highlight: 'Mod-Shift-h',
    link: 'Mod-k',
    alignLeft: 'Mod-Shift-l',
    alignCenter: 'Mod-Shift-e',
    alignRight: 'Mod-Shift-r',
    cut: 'Mod-x',
    copy: 'Mod-c',
    copyAsText: 'Mod-Alt-Shift-c',
    copyAsMarkdown: 'Mod-Alt-Shift-m',
    duplicate: 'Mod-d',
    moveUp: 'Alt-ArrowUp',
    moveDown: 'Alt-ArrowDown',
    addBelow: 'Mod-Enter',
    collapse: 'Mod-Alt-.',
    delete: 'Delete',
}

const isApplePlatform = () => {
    if (typeof navigator === 'undefined') return false
    const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent
    return /Mac|iPhone|iPad|iPod/i.test(platform)
}

const KEY_LABELS: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Delete: 'Delete',
    Backspace: 'Backspace',
    '': '-',
}

export function formatShortcut(shortcut: string): string {
    const apple = isApplePlatform()
    // 末尾的 “-” 表示减号键，split 后会产生空字符串。
    const keys = shortcut.split('-')
    return keys.map((key, index) => {
        if (key === 'Mod') return apple ? '⌘' : 'Ctrl'
        if (key === 'Alt') return apple ? '⌥' : 'Alt'
        if (key === 'Shift') return apple ? '⇧' : 'Shift'
        if (key in KEY_LABELS) return KEY_LABELS[key]
        if (index === keys.length - 1 && key.length === 1) return key.toUpperCase()
        return key
    }).join(apple ? '' : '+')
}

export function shortcutLabel(id: EditorShortcutId): string {
    return formatShortcut(EDITOR_SHORTCUTS[id])
}

export function actionTooltip(label: string, shortcutId?: EditorShortcutId, detail?: string): string {
    const shortcut = shortcutId ? ` (${shortcutLabel(shortcutId)})` : ''
    return `${label}${shortcut}${detail ? ` · ${detail}` : ''}`
}
