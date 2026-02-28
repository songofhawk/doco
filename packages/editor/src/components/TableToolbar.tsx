import { useEffect, useState, useRef, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import {
    Plus, Trash2, ArrowUpToLine, ArrowDownToLine,
    ArrowLeftToLine, ArrowRightToLine, Copy, GripHorizontal, GripVertical
} from 'lucide-react'

interface CellInfo {
    rowIdx: number
    colIdx: number
    // 当前列（表头行对应列）的位置
    colRect: { top: number; left: number; width: number }
    // 当前行（第一列对应行）的位置
    rowRect: { top: number; left: number; height: number }
    // 表格整体信息
    tableRect: { top: number; left: number; width: number; height: number }
}

/** 从 selection 找到 <table> DOM */
const findTableEl = (editor: Editor): HTMLTableElement | null => {
    const dom = editor.view.domAtPos(editor.state.selection.from)
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement
    return el?.closest('table') as HTMLTableElement | null
}

/** 找到光标所在的 <td>/<th> 及其行列索引 */
const findCellIndex = (editor: Editor): { rowIdx: number; colIdx: number; cell: HTMLTableCellElement } | null => {
    const dom = editor.view.domAtPos(editor.state.selection.from)
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement
    const cell = el?.closest('td, th') as HTMLTableCellElement | null
    if (!cell) return null
    const row = cell.parentElement as HTMLTableRowElement | null
    if (!row) return null
    const colIdx = cell.cellIndex
    const rowIdx = row.rowIndex
    return { rowIdx, colIdx, cell }
}

/** 将光标移到指定行列的单元格 */
const focusCell = (editor: Editor, tableEl: HTMLTableElement, rowIdx: number, colIdx: number) => {
    const cell = tableEl.rows[rowIdx]?.cells[colIdx]
    if (!cell) return
    const pos = editor.view.posAtDOM(cell, 0)
    editor.chain().setTextSelection(pos).run()
}

export const TableToolbar = ({ editor }: { editor: Editor }) => {
    const [info, setInfo] = useState<CellInfo | null>(null)
    const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null)
    const [colMenu, setColMenu] = useState(false)
    const [rowMenu, setRowMenu] = useState(false)
    const colMenuRef = useRef<HTMLDivElement>(null)
    const rowMenuRef = useRef<HTMLDivElement>(null)

    const measure = useCallback(() => {
        if (!editor.isActive('table')) {
            setInfo(null)
            setTableEl(null)
            return
        }
        const table = findTableEl(editor)
        const cellIdx = findCellIndex(editor)
        if (!table || !cellIdx) { setInfo(null); setTableEl(null); return }
        setTableEl(table)

        const container = editor.view.dom.closest('.tiptap-editor-container')
        if (!container) return
        const base = container.getBoundingClientRect()

        const tableR = table.getBoundingClientRect()

        // 当前列：取第一行中对应列的 cell 来获取列宽和水平位置
        const headerCell = table.rows[0]?.cells[cellIdx.colIdx]
        const colCellRect = headerCell
            ? headerCell.getBoundingClientRect()
            : cellIdx.cell.getBoundingClientRect()

        // 当前行：取该行第一个 cell 来获取行高和垂直位置
        const rowFirstCell = table.rows[cellIdx.rowIdx]?.cells[0]
        const rowCellRect = rowFirstCell
            ? rowFirstCell.getBoundingClientRect()
            : cellIdx.cell.getBoundingClientRect()

        setInfo({
            rowIdx: cellIdx.rowIdx,
            colIdx: cellIdx.colIdx,
            colRect: {
                top: colCellRect.top - base.top,
                left: colCellRect.left - base.left,
                width: colCellRect.width,
            },
            rowRect: {
                top: rowCellRect.top - base.top,
                left: rowCellRect.left - base.left,
                height: rowCellRect.height,
            },
            tableRect: {
                top: tableR.top - base.top,
                left: tableR.left - base.left,
                width: tableR.width,
                height: tableR.height,
            },
        })
    }, [editor])

    useEffect(() => {
        measure()
        editor.on('selectionUpdate', measure)
        editor.on('update', measure)
        window.addEventListener('scroll', measure, true)
        window.addEventListener('resize', measure)
        return () => {
            editor.off('selectionUpdate', measure)
            editor.off('update', measure)
            window.removeEventListener('scroll', measure, true)
            window.removeEventListener('resize', measure)
        }
    }, [editor, measure])

    // 点击外部关闭菜单
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenu(false)
            if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) setRowMenu(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // 菜单关闭当 info 变化时
    useEffect(() => { setColMenu(false); setRowMenu(false) }, [info?.rowIdx, info?.colIdx])

    if (!info || !tableEl) return null

    const closeAll = () => { setColMenu(false); setRowMenu(false) }

    return (
        <>
            {/* 当前列手柄 — 表格上方 */}
            <button
                className={`table-handle table-col-handle ${colMenu ? 'active' : ''}`}
                style={{
                    top: info.tableRect.top - 24,
                    left: info.colRect.left,
                    width: info.colRect.width,
                }}
                onClick={() => { setRowMenu(false); setColMenu(v => !v) }}
            >
                <GripHorizontal className="w-3.5 h-3.5" />
            </button>

            {/* 当前行手柄 — 表格左侧 */}
            <button
                className={`table-handle table-row-handle ${rowMenu ? 'active' : ''}`}
                style={{
                    top: info.rowRect.top,
                    left: info.tableRect.left - 24,
                    height: info.rowRect.height,
                }}
                onClick={() => { setColMenu(false); setRowMenu(v => !v) }}
            >
                <GripVertical className="w-3.5 h-3.5" />
            </button>

            {/* 列操作菜单 */}
            {colMenu && (
                <div
                    ref={colMenuRef}
                    className="table-menu"
                    style={{
                        top: info.tableRect.top - 28,
                        left: info.colRect.left + info.colRect.width / 2,
                        transform: 'translate(-50%, -100%)',
                    }}
                >
                    <TableMenu items={[
                        { icon: ArrowLeftToLine, label: '向左插入列', action: () => { editor.chain().focus().addColumnBefore().run(); closeAll() } },
                        { icon: ArrowRightToLine, label: '向右插入列', action: () => { editor.chain().focus().addColumnAfter().run(); closeAll() } },
                        null,
                        { icon: Trash2, label: '删除列', danger: true, action: () => { editor.chain().focus().deleteColumn().run(); closeAll() } },
                    ]} />
                </div>
            )}

            {/* 行操作菜单 */}
            {rowMenu && (
                <div
                    ref={rowMenuRef}
                    className="table-menu"
                    style={{
                        top: info.rowRect.top + info.rowRect.height / 2,
                        left: info.tableRect.left - 28,
                        transform: 'translate(-100%, -50%)',
                    }}
                >
                    <TableMenu items={[
                        { icon: ArrowUpToLine, label: '向上插入行', action: () => { editor.chain().focus().addRowBefore().run(); closeAll() } },
                        { icon: ArrowDownToLine, label: '向下插入行', action: () => { editor.chain().focus().addRowAfter().run(); closeAll() } },
                        null,
                        { icon: Trash2, label: '删除行', danger: true, action: () => { editor.chain().focus().deleteRow().run(); closeAll() } },
                    ]} />
                </div>
            )}

            {/* 底部添加行 */}
            <button
                className="table-add-btn table-add-row"
                style={{
                    top: info.tableRect.top + info.tableRect.height + 2,
                    left: info.tableRect.left,
                    width: info.tableRect.width,
                }}
                onClick={() => {
                    focusCell(editor, tableEl, tableEl.rows.length - 1, 0)
                    editor.chain().focus().addRowAfter().run()
                }}
            >
                <Plus className="w-3.5 h-3.5" />
            </button>

            {/* 右侧添加列 */}
            <button
                className="table-add-btn table-add-col"
                style={{
                    top: info.tableRect.top,
                    left: info.tableRect.left + info.tableRect.width + 2,
                    height: info.tableRect.height,
                }}
                onClick={() => {
                    focusCell(editor, tableEl, 0, tableEl.rows[0].cells.length - 1)
                    editor.chain().focus().addColumnAfter().run()
                }}
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </>
    )
}

/** 通用菜单项渲染 */
const TableMenu = ({ items }: { items: (null | { icon: any; label: string; action: () => void; danger?: boolean })[] }) => (
    <div className="table-menu-inner">
        {items.map((item, i) => {
            if (!item) return <div key={i} className="table-menu-divider" />
            return (
                <button
                    key={i}
                    className={`table-menu-item ${item.danger ? 'danger' : ''}`}
                    onClick={item.action}
                >
                    <item.icon className="w-4 h-4 mr-2 shrink-0" />
                    {item.label}
                </button>
            )
        })}
    </div>
)
