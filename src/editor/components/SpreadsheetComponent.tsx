import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
    AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeftToLine,
    ArrowRightToLine, ArrowUpToLine, Bold, ChevronDown, ClipboardPaste, Copy,
    Download, Eraser, Filter, Italic, Merge, Plus, Redo2, Rows3, Scissors, Sheet,
    SortAsc, SortDesc, Trash2, Underline, Undo2, UnfoldHorizontal, UnfoldVertical,
    Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, cellKey, columnName, createSpreadsheetData, evaluateSpreadsheet,
    defaultCellAlignment, formatCellValue, normalizeSpreadsheetData, parseCellKey, parseDelimited, rangeKeys,
    toCsv, type CellFormat, type CellStyle, type SpreadsheetData,
} from './spreadsheetEngine'
import {
    matchesSpreadsheetShortcut, spreadsheetActionTooltip, spreadsheetShortcutLabel,
} from '../spreadsheetShortcuts'

type Selection = { anchor: string; focus: string }
type ContextMenuState = {
    x: number
    y: number
    kind: 'cell' | 'row' | 'col'
    row: number
    col: number
}

type SpreadsheetEditorProps = {
    data: SpreadsheetData
    onChange: (data: SpreadsheetData) => void
    onUndo?: () => void
    onRedo?: () => void
    onDelete?: () => void
    standalone?: boolean
    title?: string
    onTitleChange?: (title: string) => void
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
}

const selectedKeys = (selection: Selection) => rangeKeys(selection.anchor, selection.focus)

const CELL_FORMAT_GROUPS: Array<{
    label: string
    options: Array<{ value: CellFormat; label: string }>
}> = [
    {
        label: '通用',
        options: [
            { value: 'general', label: '自动识别' },
            { value: 'text', label: '纯文本' },
        ],
    },
    {
        label: '数字',
        options: [
            { value: 'number', label: '数字' },
            { value: 'percent', label: '百分比' },
            { value: 'currency', label: '货币（人民币）' },
        ],
    },
    {
        label: '日期与逻辑',
        options: [
            { value: 'date', label: '日期' },
            { value: 'boolean', label: '布尔值' },
        ],
    },
]

const displayedDecimalPlaces = (value: number, format?: CellFormat) => {
    if (format === 'currency') return 2
    const displayedValue = format === 'percent' ? value * 100 : value
    const normalized = displayedValue.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
    return normalized.includes('.') ? normalized.length - normalized.indexOf('.') - 1 : 0
}

const selectionBounds = (selection: Selection) => {
    const a = parseCellKey(selection.anchor) || { row: 0, col: 0 }
    const b = parseCellKey(selection.focus) || a
    return {
        top: Math.min(a.row, b.row),
        bottom: Math.max(a.row, b.row),
        left: Math.min(a.col, b.col),
        right: Math.max(a.col, b.col),
    }
}

const shiftIndexedRecord = <T,>(
    cells: Record<string, T>,
    axis: 'row' | 'col',
    start: number,
    delta: number,
) => {
    const next: Record<string, T> = {}
    Object.entries(cells).forEach(([key, value]) => {
        const pos = parseCellKey(key)
        if (!pos) return
        if ((axis === 'row' ? pos.row : pos.col) === start && delta < 0) return
        if ((axis === 'row' ? pos.row : pos.col) >= start) {
            if (axis === 'row') pos.row += delta
            else pos.col += delta
        }
        if (pos.row >= 0 && pos.col >= 0) next[cellKey(pos.row, pos.col)] = value
    })
    return next
}

export const SpreadsheetEditor = ({
    data: externalData,
    onChange,
    onUndo,
    onRedo,
    onDelete,
    standalone = false,
    title = '',
    onTitleChange,
    saveStatus = 'idle',
}: SpreadsheetEditorProps) => {
    const [data, setData] = useState(() => normalizeSpreadsheetData(externalData))
    const [selection, setSelection] = useState<Selection>({ anchor: 'A1', focus: 'A1' })
    const [editing, setEditing] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const [showFilters, setShowFilters] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
    const [actionStatus, setActionStatus] = useState('')
    const gridRef = useRef<HTMLDivElement>(null)
    const fileRef = useRef<HTMLInputElement>(null)
    const dragSelecting = useRef(false)
    const actionTimerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        const incoming = normalizeSpreadsheetData(externalData)
        setData(current => JSON.stringify(incoming) === JSON.stringify(current) ? current : incoming)
    }, [externalData])

    useEffect(() => () => clearTimeout(actionTimerRef.current), [])

    useEffect(() => {
        if (!contextMenu) return
        const close = () => setContextMenu(null)
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close()
        }
        document.addEventListener('pointerdown', close)
        document.addEventListener('keydown', closeOnEscape)
        window.addEventListener('blur', close)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        return () => {
            document.removeEventListener('pointerdown', close)
            document.removeEventListener('keydown', closeOnEscape)
            window.removeEventListener('blur', close)
            window.removeEventListener('resize', close)
            window.removeEventListener('scroll', close, true)
        }
    }, [contextMenu])

    const announceAction = useCallback((message: string) => {
        clearTimeout(actionTimerRef.current)
        setActionStatus(message)
        actionTimerRef.current = setTimeout(() => setActionStatus(''), 2400)
    }, [])

    const commit = useCallback((next: SpreadsheetData) => {
        setData(next)
        onChange(next)
    }, [onChange])

    const patch = useCallback((recipe: (current: SpreadsheetData) => SpreadsheetData) => {
        const next = recipe(data)
        setData(next)
        onChange(next)
    }, [data, onChange])

    const calculated = useMemo(() => evaluateSpreadsheet(data), [data])
    const keys = useMemo(() => selectedKeys(selection), [selection])
    const bounds = useMemo(() => selectionBounds(selection), [selection])
    const activeKey = selection.focus
    const activeStyle = data.styles[activeKey] || {}
    const activeRaw = data.cells[activeKey] || ''
    const activeAlignment = defaultCellAlignment(calculated.get(activeKey), activeStyle)
    const activeValue = calculated.get(activeKey)
    const isNumericCell = typeof activeValue === 'number'
        && activeStyle.format !== 'date'
        && activeStyle.format !== 'boolean'
    const activeDecimalPlaces = activeStyle.decimalPlaces
        ?? (typeof activeValue === 'number' ? displayedDecimalPlaces(activeValue, activeStyle.format) : 0)

    const commitCell = useCallback((key: string, value: string) => {
        patch(current => {
            const cells = { ...current.cells }
            if (value === '') delete cells[key]
            else cells[key] = value
            return { ...current, cells }
        })
    }, [patch])

    const selectCell = (key: string, extend = false) => {
        setSelection(current => ({ anchor: extend ? current.anchor : key, focus: key }))
        gridRef.current?.focus({ preventScroll: true })
    }

    const beginEdit = (key: string, initial?: string) => {
        setSelection({ anchor: key, focus: key })
        setDraft(initial ?? data.cells[key] ?? '')
        setEditing(key)
    }

    const finishEdit = (move?: 'down' | 'right') => {
        if (!editing) return
        commitCell(editing, draft)
        const pos = parseCellKey(editing)
        setEditing(null)
        if (!pos || !move) return
        const row = Math.min(data.rows - 1, pos.row + (move === 'down' ? 1 : 0))
        const col = Math.min(data.cols - 1, pos.col + (move === 'right' ? 1 : 0))
        selectCell(cellKey(row, col))
    }

    const setSelectedStyle = (style: Partial<CellStyle>) => {
        patch(current => {
            const styles = { ...current.styles }
            keys.forEach(key => { styles[key] = { ...styles[key], ...style } })
            return { ...current, styles }
        })
    }

    const clearSelected = () => {
        patch(current => {
            const cells = { ...current.cells }
            keys.forEach(key => delete cells[key])
            return { ...current, cells }
        })
    }

    const copySelection = async (cut = false) => {
        const rows: string[] = []
        for (let row = bounds.top; row <= bounds.bottom; row += 1) {
            const values = []
            for (let col = bounds.left; col <= bounds.right; col += 1) values.push(data.cells[cellKey(row, col)] || '')
            rows.push(values.join('\t'))
        }
        await navigator.clipboard.writeText(rows.join('\n'))
        if (cut) clearSelected()
    }

    const pasteText = (text: string) => {
        const matrix = parseDelimited(text)
        const start = parseCellKey(activeKey)
        if (!start) return
        patch(current => {
            const rows = Math.min(MAX_ROWS, Math.max(current.rows, start.row + matrix.length))
            const cols = Math.min(MAX_COLS, Math.max(current.cols, start.col + Math.max(...matrix.map(row => row.length))))
            const cells = { ...current.cells }
            matrix.forEach((row, rowOffset) => row.forEach((value, colOffset) => {
                if (start.row + rowOffset < rows && start.col + colOffset < cols) {
                    const key = cellKey(start.row + rowOffset, start.col + colOffset)
                    if (value === '') delete cells[key]
                    else cells[key] = value
                }
            }))
            return { ...current, rows, cols, cells }
        })
    }

    const pasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText()
            if (!text) {
                announceAction('剪贴板中没有可粘贴的文本')
                return
            }
            pasteText(text)
            announceAction('已粘贴剪贴板内容')
        } catch {
            announceAction('浏览器未允许读取剪贴板，请使用 Ctrl/⌘ + V')
        }
    }

    const moveSelection = (rowDelta: number, colDelta: number, extend = false) => {
        const pos = parseCellKey(activeKey)
        if (!pos) return
        const row = Math.max(0, Math.min(data.rows - 1, pos.row + rowDelta))
        const col = Math.max(0, Math.min(data.cols - 1, pos.col + colDelta))
        selectCell(cellKey(row, col), extend)
    }

    const handleKeyDown = (event: React.KeyboardEvent) => {
        const target = event.target as HTMLElement
        if (
            target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement
            || target.isContentEditable
        ) return
        if (editing) return
        if (matchesSpreadsheetShortcut(event, 'undo') && onUndo) {
            event.preventDefault()
            onUndo()
            return
        }
        if ((matchesSpreadsheetShortcut(event, 'redo') || matchesSpreadsheetShortcut(event, 'redoAlternative')) && onRedo) {
            event.preventDefault()
            onRedo()
            return
        }
        if (matchesSpreadsheetShortcut(event, 'bold')) {
            event.preventDefault()
            setSelectedStyle({ bold: !activeStyle.bold })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'italic')) {
            event.preventDefault()
            setSelectedStyle({ italic: !activeStyle.italic })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'underline')) {
            event.preventDefault()
            setSelectedStyle({ underline: !activeStyle.underline })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'alignLeft')) {
            event.preventDefault()
            setSelectedStyle({ align: 'left' })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'alignCenter')) {
            event.preventDefault()
            setSelectedStyle({ align: 'center' })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'alignRight')) {
            event.preventDefault()
            setSelectedStyle({ align: 'right' })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'copy')) { event.preventDefault(); void copySelection(); return }
        if (matchesSpreadsheetShortcut(event, 'cut')) { event.preventDefault(); void copySelection(true); return }
        if (matchesSpreadsheetShortcut(event, 'selectAll')) {
            event.preventDefault()
            setSelection({ anchor: 'A1', focus: cellKey(data.rows - 1, data.cols - 1) })
            return
        }
        if (matchesSpreadsheetShortcut(event, 'clear') || event.key === 'Backspace') { event.preventDefault(); clearSelected(); return }
        if (matchesSpreadsheetShortcut(event, 'edit')) { event.preventDefault(); beginEdit(activeKey); return }
        if (matchesSpreadsheetShortcut(event, 'moveNext') || matchesSpreadsheetShortcut(event, 'movePrevious')) {
            event.preventDefault()
            moveSelection(0, event.shiftKey ? -1 : 1)
            return
        }
        const arrows: Record<string, [number, number]> = {
            ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
        }
        if (arrows[event.key]) {
            event.preventDefault()
            moveSelection(arrows[event.key][0], arrows[event.key][1], event.shiftKey)
            return
        }
        if (!(event.metaKey || event.ctrlKey) && event.key.length === 1) {
            event.preventDefault()
            beginEdit(activeKey, event.key)
        }
    }

    const mergeSelection = () => {
        if (keys.length < 2) return
        const range = `${cellKey(bounds.top, bounds.left)}:${cellKey(bounds.bottom, bounds.right)}`
        const isMerged = data.merges.includes(range)
        patch(current => ({
            ...current,
            merges: isMerged ? current.merges.filter(item => item !== range) : [...current.merges, range],
        }))
        announceAction(isMerged ? '已取消合并单元格' : `已合并 ${keys.length} 个单元格`)
    }

    const mergeMap = useMemo(() => {
        const map = new Map<string, { master: string; rowSpan: number; colSpan: number }>()
        data.merges.forEach(range => {
            const [start, end] = range.split(':')
            const first = parseCellKey(start)
            const last = parseCellKey(end)
            if (!first || !last) return
            for (let row = first.row; row <= last.row; row += 1) {
                for (let col = first.col; col <= last.col; col += 1) {
                    map.set(cellKey(row, col), {
                        master: start,
                        rowSpan: last.row - first.row + 1,
                        colSpan: last.col - first.col + 1,
                    })
                }
            }
        })
        return map
    }, [data.merges])

    const changeDimension = (
        axis: 'row' | 'col',
        mode: 'insert' | 'delete',
        targetIndex = axis === 'row' ? bounds.top : bounds.left,
    ) => {
        const start = targetIndex
        const size = axis === 'row' ? data.rows : data.cols
        const limit = axis === 'row' ? (mode === 'insert' ? MAX_ROWS : MIN_ROWS) : (mode === 'insert' ? MAX_COLS : MIN_COLS)
        if ((mode === 'insert' && size >= limit) || (mode === 'delete' && size <= limit)) {
            announceAction(mode === 'insert' ? `已达到最大${axis === 'row' ? '行' : '列'}数` : `至少保留 ${limit} ${axis === 'row' ? '行' : '列'}`)
            return
        }
        patch(current => {
            const delta = mode === 'insert' ? 1 : -1
            const cells = shiftIndexedRecord(current.cells, axis, start, delta)
            const styles = shiftIndexedRecord(current.styles, axis, start, delta)
            const next = { ...current, cells, styles, merges: [] }
            if (axis === 'row') next.rows += mode === 'insert' ? 1 : -1
            else next.cols += mode === 'insert' ? 1 : -1
            return next
        })
        const nextRow = axis === 'row'
            ? Math.min(start, data.rows - (mode === 'delete' ? 2 : 1))
            : bounds.top
        const nextCol = axis === 'col'
            ? Math.min(start, data.cols - (mode === 'delete' ? 2 : 1))
            : bounds.left
        selectCell(cellKey(Math.max(0, nextRow), Math.max(0, nextCol)))
        setMenuOpen(false)
        setContextMenu(null)
        announceAction(`${mode === 'insert' ? '已插入' : '已删除'}第 ${start + 1} ${axis === 'row' ? '行' : '列'}`)
    }

    const openContextMenu = (
        event: React.MouseEvent,
        kind: ContextMenuState['kind'],
        row: number,
        col: number,
    ) => {
        event.preventDefault()
        event.stopPropagation()
        if (kind === 'row') {
            setSelection({ anchor: cellKey(row, 0), focus: cellKey(row, data.cols - 1) })
        } else if (kind === 'col') {
            setSelection({ anchor: cellKey(0, col), focus: cellKey(data.rows - 1, col) })
        } else if (row < bounds.top || row > bounds.bottom || col < bounds.left || col > bounds.right) {
            setSelection({ anchor: cellKey(row, col), focus: cellKey(row, col) })
        }
        setMenuOpen(false)
        setEditing(null)
        setContextMenu({ x: event.clientX, y: event.clientY, kind, row, col })
    }

    const sortRows = (descending: boolean) => {
        const col = bounds.left
        const rowHasContent = (row: number) => {
            for (let colIndex = 0; colIndex < data.cols; colIndex += 1) {
                if (data.cells[cellKey(row, colIndex)] !== undefined) return true
            }
            return false
        }
        const selectedWholeColumn = bounds.top === 0 && bounds.bottom === data.rows - 1
        const candidateRows = Array.from(
            { length: selectedWholeColumn ? data.rows : bounds.bottom - bounds.top + 1 },
            (_, index) => index + (selectedWholeColumn ? 0 : bounds.top),
        ).filter(rowHasContent)
        const headerRow = selectedWholeColumn && candidateRows.length > 1 ? candidateRows.shift() : undefined
        if (candidateRows.length < 2) {
            announceAction(`当前区域没有足够数据可按 ${columnName(col)} 列排序`)
            return
        }
        const sortedRows = [...candidateRows].sort((a, b) => {
            const left = calculated.get(cellKey(a, col))
            const right = calculated.get(cellKey(b, col))
            const comparison = typeof left === 'number' && typeof right === 'number'
                ? left - right
                : String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
            return descending ? -comparison : comparison
        })
        patch(current => {
            const cells = { ...current.cells }
            const styles = { ...current.styles }
            const targetRows = candidateRows
            targetRows.forEach(targetRow => {
                for (let colIndex = 0; colIndex < current.cols; colIndex += 1) {
                    const target = cellKey(targetRow, colIndex)
                    delete cells[target]
                    delete styles[target]
                }
            })
            sortedRows.forEach((sourceRow, index) => {
                const targetRow = targetRows[index]
                for (let colIndex = 0; colIndex < current.cols; colIndex += 1) {
                    const source = cellKey(sourceRow, colIndex)
                    const target = cellKey(targetRow, colIndex)
                    if (current.cells[source] !== undefined) cells[target] = current.cells[source]
                    if (current.styles[source]) styles[target] = current.styles[source]
                }
            })
            return { ...current, cells, styles, merges: [] }
        })
        announceAction(`已按 ${columnName(col)} 列${descending ? '降序' : '升序'}排列 ${candidateRows.length} 行${headerRow !== undefined ? '，首行保留为表头' : ''}`)
    }

    const hiddenRows = useMemo(() => {
        const result = new Set<number>()
        if (!showFilters) return result
        Object.entries(data.filters).forEach(([colName, query]) => {
            if (!query) return
            const col = Number(colName)
            for (let row = 0; row < data.rows; row += 1) {
                if (!String(calculated.get(cellKey(row, col))).toLowerCase().includes(query.toLowerCase())) result.add(row)
            }
        })
        return result
    }, [calculated, data.filters, data.rows, showFilters])

    const resizeColumn = (col: number, event: React.PointerEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startWidth = data.colWidths[String(col)] || 120
        const move = (moveEvent: PointerEvent) => {
            const width = Math.max(64, Math.min(420, startWidth + moveEvent.clientX - startX))
            setData(current => ({ ...current, colWidths: { ...current.colWidths, [String(col)]: width } }))
        }
        const up = (upEvent: PointerEvent) => {
            const width = Math.max(64, Math.min(420, startWidth + upEvent.clientX - startX))
            patch(current => ({ ...current, colWidths: { ...current.colWidths, [String(col)]: width } }))
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
    }

    const importFile = async (file?: File) => {
        if (!file) return
        const matrix = parseDelimited(await file.text())
        const next = createSpreadsheetData(
            Math.max(10, Math.min(MAX_ROWS, matrix.length)),
            Math.max(6, Math.min(MAX_COLS, Math.max(...matrix.map(row => row.length)))),
        )
        matrix.forEach((row, rowIndex) => row.forEach((value, colIndex) => {
            if (value) next.cells[cellKey(rowIndex, colIndex)] = value
        }))
        commit(next)
        setSelection({ anchor: 'A1', focus: 'A1' })
    }

    const exportCsv = () => {
        const blob = new Blob([`\uFEFF${toCsv(data, calculated.values)}`], { type: 'text/csv;charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = '电子表格.csv'
        link.click()
        URL.revokeObjectURL(link.href)
    }

    const stickyOffset = (col: number) => {
        let offset = 42
        for (let index = 0; index < col; index += 1) offset += data.colWidths[String(index)] || 120
        return offset
    }

    const invokeContextAction = (action: () => void | Promise<void>) => {
        setContextMenu(null)
        void action()
    }

    const contextMenuStyle = contextMenu ? {
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 226)),
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - (contextMenu.kind === 'cell' ? 340 : 300))),
    } : undefined

    const Wrapper = standalone ? 'div' : NodeViewWrapper

    return (
        <Wrapper
            className={`spreadsheet-block ${standalone ? 'spreadsheet-block-standalone' : ''}`}
            data-type="spreadsheet"
            contentEditable={false}
            onKeyDown={handleKeyDown}
            onMouseUp={() => { dragSelecting.current = false }}
            onMouseLeave={() => { dragSelecting.current = false }}
        >
            <div className="spreadsheet-shell">
                <div className="spreadsheet-titlebar">
                    <div className={`spreadsheet-title ${standalone ? 'spreadsheet-title-standalone' : ''}`}>
                        <Sheet size={17} />
                        {standalone ? (
                            <input
                                className="spreadsheet-document-title"
                                aria-label="电子表格标题"
                                value={title}
                                onChange={(event) => onTitleChange?.(event.target.value)}
                                placeholder="无标题电子表格"
                            />
                        ) : '电子表格'}
                        {standalone && (
                            <span className="standalone-spreadsheet-save" role="status">
                                {saveStatus === 'saving' && '正在保存…'}
                                {saveStatus === 'saved' && '已保存'}
                                {saveStatus === 'error' && '保存失败'}
                            </span>
                        )}
                    </div>
                    <div className="spreadsheet-title-actions document-title-actions">
                        <button type="button" title={spreadsheetActionTooltip('撤销', 'undo')} disabled={!onUndo} onClick={onUndo}><Undo2 size={16} /></button>
                        <button type="button" title={spreadsheetActionTooltip('重做', 'redo')} disabled={!onRedo} onClick={onRedo}><Redo2 size={16} /></button>
                        <button type="button" title="导入 CSV" onClick={() => fileRef.current?.click()}><Upload size={16} /></button>
                        <button type="button" title="导出 CSV" onClick={exportCsv}><Download size={16} /></button>
                        {onDelete && <button type="button" className="danger" title="删除电子表格" onClick={onDelete}><Trash2 size={16} /></button>}
                        <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" hidden onChange={event => void importFile(event.target.files?.[0])} />
                    </div>
                </div>

                <div className="spreadsheet-toolbar">
                    <button type="button" className={activeStyle.bold ? 'active' : ''} title={spreadsheetActionTooltip('粗体', 'bold')} onClick={() => setSelectedStyle({ bold: !activeStyle.bold })}><Bold size={15} /></button>
                    <button type="button" className={activeStyle.italic ? 'active' : ''} title={spreadsheetActionTooltip('斜体', 'italic')} onClick={() => setSelectedStyle({ italic: !activeStyle.italic })}><Italic size={15} /></button>
                    <button type="button" className={activeStyle.underline ? 'active' : ''} title={spreadsheetActionTooltip('下划线', 'underline')} onClick={() => setSelectedStyle({ underline: !activeStyle.underline })}><Underline size={15} /></button>
                    <span className="spreadsheet-divider" />
                    <button type="button" className={activeAlignment === 'left' ? 'active' : ''} title={spreadsheetActionTooltip('左对齐', 'alignLeft')} onClick={() => setSelectedStyle({ align: 'left' })}><AlignLeft size={15} /></button>
                    <button type="button" className={activeAlignment === 'center' ? 'active' : ''} title={spreadsheetActionTooltip('居中', 'alignCenter')} onClick={() => setSelectedStyle({ align: 'center' })}><AlignCenter size={15} /></button>
                    <button type="button" className={activeAlignment === 'right' ? 'active' : ''} title={spreadsheetActionTooltip('右对齐', 'alignRight')} onClick={() => setSelectedStyle({ align: 'right' })}><AlignRight size={15} /></button>
                    <span className="spreadsheet-divider" />
                    <label title="文字颜色" className="spreadsheet-color-control">
                        A<input type="color" value={activeStyle.color || '#141413'} onChange={event => setSelectedStyle({ color: event.target.value })} />
                    </label>
                    <label title="填充颜色" className="spreadsheet-color-control fill">
                        <span /> <input type="color" value={activeStyle.background || '#faf9f5'} onChange={event => setSelectedStyle({ background: event.target.value })} />
                    </label>
                    <select aria-label="单元格类型" value={activeStyle.format || 'general'} onChange={event => setSelectedStyle({ format: event.target.value as CellFormat })}>
                        {CELL_FORMAT_GROUPS.map(group => (
                            <optgroup key={group.label} label={group.label}>
                                {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </optgroup>
                        ))}
                    </select>
                    {isNumericCell && (
                        <div className="spreadsheet-decimal-controls" aria-label="小数位数">
                            <button
                                type="button"
                                className="spreadsheet-tool-button"
                                aria-label="减少小数位数"
                                data-tooltip="减少小数位数"
                                disabled={activeDecimalPlaces <= 0}
                                onClick={() => setSelectedStyle({ decimalPlaces: Math.max(0, activeDecimalPlaces - 1) })}
                            >
                                <span className="spreadsheet-decimal-icon" aria-hidden="true">.0<sup>−</sup></span>
                            </button>
                            <button
                                type="button"
                                className="spreadsheet-tool-button"
                                aria-label="增加小数位数"
                                data-tooltip="增加小数位数"
                                disabled={activeDecimalPlaces >= 8}
                                onClick={() => setSelectedStyle({ decimalPlaces: Math.min(8, activeDecimalPlaces + 1) })}
                            >
                                <span className="spreadsheet-decimal-icon" aria-hidden="true">.0<sup>+</sup></span>
                            </button>
                        </div>
                    )}
                    <span className="spreadsheet-divider" />
                    <button
                        type="button"
                        className={`spreadsheet-tool-button ${data.merges.some(range => range.startsWith(`${cellKey(bounds.top, bounds.left)}:`)) ? 'active' : ''}`}
                        aria-label="合并或取消合并单元格"
                        data-tooltip={keys.length < 2 ? '请先拖选多个单元格' : '合并 / 取消合并单元格'}
                        disabled={keys.length < 2}
                        onClick={mergeSelection}
                    ><Merge size={15} /></button>
                    <button
                        type="button"
                        className="spreadsheet-tool-button"
                        aria-label={`按 ${columnName(bounds.left)} 列升序排序`}
                        data-tooltip={`按 ${columnName(bounds.left)} 列升序排序`}
                        onClick={() => sortRows(false)}
                    ><SortAsc size={15} /></button>
                    <button
                        type="button"
                        className="spreadsheet-tool-button"
                        aria-label={`按 ${columnName(bounds.left)} 列降序排序`}
                        data-tooltip={`按 ${columnName(bounds.left)} 列降序排序`}
                        onClick={() => sortRows(true)}
                    ><SortDesc size={15} /></button>
                    <button type="button" className={showFilters ? 'active' : ''} title="筛选" onClick={() => setShowFilters(value => !value)}><Filter size={15} /></button>
                    <div className="spreadsheet-more">
                        <button type="button" onClick={() => setMenuOpen(value => !value)}>行列 <ChevronDown size={13} /></button>
                        {menuOpen && (
                            <div className="spreadsheet-menu">
                                <button type="button" onClick={() => changeDimension('row', 'insert')}><Plus size={14} />在上方插入行</button>
                                <button type="button" onClick={() => changeDimension('col', 'insert')}><Plus size={14} />在左侧插入列</button>
                                <button type="button" onClick={() => changeDimension('row', 'delete')}><UnfoldVertical size={14} />删除当前行</button>
                                <button type="button" onClick={() => changeDimension('col', 'delete')}><UnfoldHorizontal size={14} />删除当前列</button>
                                <button type="button" onClick={() => {
                                    patch(current => ({ ...current, rows: Math.min(MAX_ROWS, current.rows + 10) }))
                                    setMenuOpen(false)
                                    announceAction(`已追加 ${Math.min(10, MAX_ROWS - data.rows)} 行`)
                                }}><Rows3 size={14} />追加 10 行</button>
                                <button type="button" onClick={() => {
                                    const next = data.frozenRows === bounds.top + 1 ? 0 : bounds.top + 1
                                    patch(current => ({ ...current, frozenRows: next }))
                                    setMenuOpen(false)
                                    announceAction(next ? `已冻结前 ${next} 行` : '已取消冻结行')
                                }}>{data.frozenRows === bounds.top + 1 ? '取消冻结行' : `冻结到第 ${bounds.top + 1} 行`}</button>
                                <button type="button" onClick={() => {
                                    const next = data.frozenCols === bounds.left + 1 ? 0 : bounds.left + 1
                                    patch(current => ({ ...current, frozenCols: next }))
                                    setMenuOpen(false)
                                    announceAction(next ? `已冻结前 ${next} 列` : '已取消冻结列')
                                }}>{data.frozenCols === bounds.left + 1 ? '取消冻结列' : `冻结到第 ${bounds.left + 1} 列`}</button>
                            </div>
                        )}
                    </div>
                    <span className="spreadsheet-divider" />
                    <button type="button" title={spreadsheetActionTooltip('复制', 'copy')} onClick={() => void copySelection()}><Copy size={15} /></button>
                    <button type="button" title={spreadsheetActionTooltip('剪切', 'cut')} onClick={() => void copySelection(true)}><Scissors size={15} /></button>
                </div>

                <div className="spreadsheet-formula">
                    <span className="spreadsheet-name-box">{activeKey}</span>
                    <span className="spreadsheet-fx">fx</span>
                    <input
                        aria-label="公式栏"
                        value={activeRaw}
                        placeholder="输入内容或公式，例如 =SUM(A1:A10)"
                        onChange={event => commitCell(activeKey, event.target.value)}
                        onKeyDown={event => event.stopPropagation()}
                    />
                </div>

                <div
                    ref={gridRef}
                    className="spreadsheet-grid"
                    role="grid"
                    tabIndex={0}
                    aria-label="电子表格"
                    onPaste={event => { event.preventDefault(); pasteText(event.clipboardData.getData('text/plain')) }}
                >
                    <table>
                        <colgroup>
                            <col style={{ width: 42 }} />
                            {Array.from({ length: data.cols }, (_, col) => <col key={col} style={{ width: data.colWidths[String(col)] || 120 }} />)}
                        </colgroup>
                        <thead>
                            <tr>
                                <th className="spreadsheet-corner" />
                                {Array.from({ length: data.cols }, (_, col) => (
                                    <th
                                        key={col}
                                        className={col >= bounds.left && col <= bounds.right ? 'selected-header' : ''}
                                        style={col < data.frozenCols ? { position: 'sticky', left: stickyOffset(col), zIndex: 7 } : undefined}
                                        onClick={() => setSelection({ anchor: cellKey(0, col), focus: cellKey(data.rows - 1, col) })}
                                        onContextMenu={event => openContextMenu(event, 'col', bounds.top, col)}
                                    >
                                        {columnName(col)}
                                        <span className="spreadsheet-col-resize" onPointerDown={event => resizeColumn(col, event)} />
                                    </th>
                                ))}
                            </tr>
                            {showFilters && (
                                <tr className="spreadsheet-filter-row">
                                    <th />
                                    {Array.from({ length: data.cols }, (_, col) => (
                                        <th key={col}>
                                            <input
                                                aria-label={`筛选 ${columnName(col)} 列`}
                                                value={data.filters[String(col)] || ''}
                                                placeholder="筛选"
                                                onChange={event => patch(current => ({ ...current, filters: { ...current.filters, [String(col)]: event.target.value } }))}
                                            />
                                        </th>
                                    ))}
                                </tr>
                            )}
                        </thead>
                        <tbody>
                            {Array.from({ length: data.rows }, (_, row) => hiddenRows.has(row) ? null : (
                                <tr key={row}>
                                    <th
                                        className={row >= bounds.top && row <= bounds.bottom ? 'selected-header' : ''}
                                        style={row < data.frozenRows ? { position: 'sticky', top: showFilters ? 56 : 28, zIndex: 6 } : undefined}
                                        onClick={() => setSelection({ anchor: cellKey(row, 0), focus: cellKey(row, data.cols - 1) })}
                                        onContextMenu={event => openContextMenu(event, 'row', row, bounds.left)}
                                    >{row + 1}</th>
                                    {Array.from({ length: data.cols }, (_, col) => {
                                        const key = cellKey(row, col)
                                        const merge = mergeMap.get(key)
                                        if (merge && merge.master !== key) return null
                                        const style = data.styles[key] || {}
                                        const selected = keys.includes(key) || (merge && keys.includes(merge.master))
                                        const isActive = key === activeKey
                                        return (
                                            <td
                                                key={key}
                                                role="gridcell"
                                                aria-selected={selected}
                                                rowSpan={merge?.rowSpan}
                                                colSpan={merge?.colSpan}
                                                className={`${selected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                                                style={{
                                                    fontWeight: style.bold ? 700 : undefined,
                                                    fontStyle: style.italic ? 'italic' : undefined,
                                                    textDecoration: style.underline ? 'underline' : undefined,
                                                    textAlign: defaultCellAlignment(calculated.get(key), style),
                                                    color: style.color,
                                                    backgroundColor: style.background,
                                                    ...(col < data.frozenCols ? { position: 'sticky', left: stickyOffset(col), zIndex: 4 } : {}),
                                                    ...(row < data.frozenRows ? { position: 'sticky', top: showFilters ? 56 : 28, zIndex: 3 } : {}),
                                                }}
                                                onMouseDown={event => {
                                                    event.preventDefault()
                                                    dragSelecting.current = true
                                                    selectCell(key, event.shiftKey)
                                                }}
                                                onMouseEnter={() => {
                                                    if (dragSelecting.current) setSelection(current => ({ ...current, focus: key }))
                                                }}
                                                onDoubleClick={() => beginEdit(key)}
                                                onContextMenu={event => openContextMenu(event, 'cell', row, col)}
                                            >
                                                {editing === key ? (
                                                    <input
                                                        autoFocus
                                                        value={draft}
                                                        onChange={event => setDraft(event.target.value)}
                                                        onBlur={() => finishEdit()}
                                                        onKeyDown={event => {
                                                            event.stopPropagation()
                                                            if (event.key === 'Escape') setEditing(null)
                                                            if (event.key === 'Enter') { event.preventDefault(); finishEdit('down') }
                                                            if (event.key === 'Tab') { event.preventDefault(); finishEdit('right') }
                                                        }}
                                                    />
                                                ) : (
                                                    <span title={String(calculated.get(key))}>{formatCellValue(calculated.get(key), style)}</span>
                                                )}
                                            </td>
                                        )
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="spreadsheet-status">
                    <span>{data.rows} 行 × {data.cols} 列</span>
                    <span>已选择 {keys.length} 个单元格</span>
                    {keys.length > 1 && <span>求和：{keys.reduce((sum, key) => {
                        const value = calculated.get(key)
                        return sum + (typeof value === 'number' ? value : 0)
                    }, 0)}</span>}
                    {actionStatus && <span className="spreadsheet-action-status" role="status">{actionStatus}</span>}
                </div>
            </div>
            {contextMenu && createPortal(
                <div
                    className="spreadsheet-context-menu"
                    role="menu"
                    aria-label={`${contextMenu.kind === 'cell' ? '单元格' : contextMenu.kind === 'row' ? '行' : '列'}操作`}
                    style={contextMenuStyle}
                    onPointerDown={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    <div className="spreadsheet-context-title">
                        {contextMenu.kind === 'cell' && `${cellKey(contextMenu.row, contextMenu.col)} 单元格`}
                        {contextMenu.kind === 'row' && `第 ${contextMenu.row + 1} 行`}
                        {contextMenu.kind === 'col' && `${columnName(contextMenu.col)} 列`}
                    </div>
                    <button type="button" role="menuitem" onClick={() => invokeContextAction(() => copySelection())}>
                        <Copy size={15} />复制
                        <kbd>{spreadsheetShortcutLabel('copy')}</kbd>
                    </button>
                    <button type="button" role="menuitem" onClick={() => invokeContextAction(() => copySelection(true))}>
                        <Scissors size={15} />剪切
                        <kbd>{spreadsheetShortcutLabel('cut')}</kbd>
                    </button>
                    {contextMenu.kind === 'cell' && (
                        <button type="button" role="menuitem" onClick={() => invokeContextAction(pasteFromClipboard)}>
                            <ClipboardPaste size={15} />粘贴
                            <kbd>{spreadsheetShortcutLabel('paste')}</kbd>
                        </button>
                    )}
                    <div className="spreadsheet-context-divider" />
                    {(contextMenu.kind === 'cell' || contextMenu.kind === 'row') && (
                        <>
                            <button type="button" role="menuitem" onClick={() => invokeContextAction(() => changeDimension('row', 'insert', contextMenu.row))}>
                                <ArrowUpToLine size={15} />在上方插入行
                            </button>
                            <button type="button" role="menuitem" onClick={() => invokeContextAction(() => changeDimension('row', 'insert', contextMenu.row + 1))}>
                                <ArrowDownToLine size={15} />在下方插入行
                            </button>
                        </>
                    )}
                    {(contextMenu.kind === 'cell' || contextMenu.kind === 'col') && (
                        <>
                            <button type="button" role="menuitem" onClick={() => invokeContextAction(() => changeDimension('col', 'insert', contextMenu.col))}>
                                <ArrowLeftToLine size={15} />在左侧插入列
                            </button>
                            <button type="button" role="menuitem" onClick={() => invokeContextAction(() => changeDimension('col', 'insert', contextMenu.col + 1))}>
                                <ArrowRightToLine size={15} />在右侧插入列
                            </button>
                        </>
                    )}
                    {contextMenu.kind === 'col' && (
                        <>
                            <div className="spreadsheet-context-divider" />
                            <button type="button" role="menuitem" onClick={() => invokeContextAction(() => sortRows(false))}>
                                <SortAsc size={15} />升序排列
                            </button>
                            <button type="button" role="menuitem" onClick={() => invokeContextAction(() => sortRows(true))}>
                                <SortDesc size={15} />降序排列
                            </button>
                        </>
                    )}
                    <div className="spreadsheet-context-divider" />
                    <button type="button" role="menuitem" onClick={() => invokeContextAction(() => {
                        clearSelected()
                        announceAction('已清除所选单元格内容')
                    })}>
                        <Eraser size={15} />清除内容
                    </button>
                    {contextMenu.kind === 'row' && (
                        <button className="danger" type="button" role="menuitem" onClick={() => invokeContextAction(() => changeDimension('row', 'delete', contextMenu.row))}>
                            <Trash2 size={15} />删除第 {contextMenu.row + 1} 行
                        </button>
                    )}
                    {contextMenu.kind === 'col' && (
                        <button className="danger" type="button" role="menuitem" onClick={() => invokeContextAction(() => changeDimension('col', 'delete', contextMenu.col))}>
                            <Trash2 size={15} />删除 {columnName(contextMenu.col)} 列
                        </button>
                    )}
                </div>,
                document.body,
            )}
        </Wrapper>
    )
}

const SpreadsheetComponent = ({ node, updateAttributes, editor, deleteNode }: NodeViewProps) => (
    <SpreadsheetEditor
        data={normalizeSpreadsheetData(node.attrs.data)}
        onChange={(data) => updateAttributes({ data })}
        onUndo={() => editor.chain().focus().undo().run()}
        onRedo={() => editor.chain().focus().redo().run()}
        onDelete={deleteNode}
    />
)

export default SpreadsheetComponent
