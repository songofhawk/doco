import { EDITOR_SHORTCUTS, formatShortcut } from './editorShortcuts'

export type SpreadsheetShortcutId =
    | 'undo' | 'redo' | 'redoAlternative'
    | 'bold' | 'italic' | 'underline'
    | 'alignLeft' | 'alignCenter' | 'alignRight'
    | 'copy' | 'cut' | 'paste' | 'selectAll'
    | 'clear' | 'edit' | 'moveNext' | 'movePrevious'

/**
 * 电子表格与文档对相同语义复用同一组按键。
 * 表格独有的导航与选择操作也集中在这里，避免执行逻辑和 tooltip 漂移。
 */
export const SPREADSHEET_SHORTCUTS: Record<SpreadsheetShortcutId, string> = {
    undo: 'Mod-z',
    redo: 'Shift-Mod-z',
    redoAlternative: 'Mod-y',
    bold: EDITOR_SHORTCUTS.bold,
    italic: EDITOR_SHORTCUTS.italic,
    underline: EDITOR_SHORTCUTS.underline,
    alignLeft: EDITOR_SHORTCUTS.alignLeft,
    alignCenter: EDITOR_SHORTCUTS.alignCenter,
    alignRight: EDITOR_SHORTCUTS.alignRight,
    copy: EDITOR_SHORTCUTS.copy,
    cut: EDITOR_SHORTCUTS.cut,
    paste: 'Mod-v',
    selectAll: 'Mod-a',
    clear: 'Delete',
    edit: 'Enter',
    moveNext: 'Tab',
    movePrevious: 'Shift-Tab',
}

export function spreadsheetShortcutLabel(id: SpreadsheetShortcutId): string {
    return formatShortcut(SPREADSHEET_SHORTCUTS[id])
}

export function spreadsheetActionTooltip(label: string, id: SpreadsheetShortcutId): string {
    return `${label} (${spreadsheetShortcutLabel(id)})`
}

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

export function matchesSpreadsheetShortcut(event: ShortcutEvent, id: SpreadsheetShortcutId): boolean {
    const shortcut = SPREADSHEET_SHORTCUTS[id]
    const parts = shortcut.split('-')
    const key = parts.at(-1) || ''
    const requiresMod = parts.includes('Mod')
    const requiresCtrl = parts.includes('Ctrl')
    const requiresAlt = parts.includes('Alt')
    const requiresShift = parts.includes('Shift')

    if (requiresMod) {
        if (!(event.metaKey || event.ctrlKey)) return false
    } else {
        if (event.metaKey) return false
        if (event.ctrlKey !== requiresCtrl) return false
    }
    if (event.altKey !== requiresAlt) return false
    if (event.shiftKey !== requiresShift) return false
    return event.key.toLowerCase() === key.toLowerCase()
}
