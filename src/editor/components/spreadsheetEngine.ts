export type CellValue = string | number | boolean

export type CellStyle = {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    align?: 'left' | 'center' | 'right'
    color?: string
    background?: string
    format?: 'general' | 'number' | 'percent' | 'currency' | 'date'
}

export type SpreadsheetData = {
    version: 1
    rows: number
    cols: number
    cells: Record<string, string>
    styles: Record<string, CellStyle>
    colWidths: Record<string, number>
    merges: string[]
    frozenRows: number
    frozenCols: number
    filters: Record<string, string>
}

export const MIN_ROWS = 10
export const MIN_COLS = 6
export const MAX_ROWS = 500
export const MAX_COLS = 100

export const createSpreadsheetData = (rows = 30, cols = 12): SpreadsheetData => ({
    version: 1,
    rows,
    cols,
    cells: {},
    styles: {},
    colWidths: {},
    merges: [],
    frozenRows: 0,
    frozenCols: 0,
    filters: {},
})

export const normalizeSpreadsheetData = (value: unknown): SpreadsheetData => {
    const source = value && typeof value === 'object' ? value as Partial<SpreadsheetData> : {}
    return {
        version: 1,
        rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, Number(source.rows) || 30)),
        cols: Math.min(MAX_COLS, Math.max(MIN_COLS, Number(source.cols) || 12)),
        cells: source.cells && typeof source.cells === 'object' ? source.cells : {},
        styles: source.styles && typeof source.styles === 'object' ? source.styles : {},
        colWidths: source.colWidths && typeof source.colWidths === 'object' ? source.colWidths : {},
        merges: Array.isArray(source.merges) ? source.merges : [],
        frozenRows: Math.max(0, Number(source.frozenRows) || 0),
        frozenCols: Math.max(0, Number(source.frozenCols) || 0),
        filters: source.filters && typeof source.filters === 'object' ? source.filters : {},
    }
}

export const columnName = (index: number) => {
    let result = ''
    let value = index + 1
    while (value > 0) {
        value -= 1
        result = String.fromCharCode(65 + (value % 26)) + result
        value = Math.floor(value / 26)
    }
    return result
}

export const columnIndex = (name: string) => {
    let result = 0
    for (const char of name.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64
    return result - 1
}

export const cellKey = (row: number, col: number) => `${columnName(col)}${row + 1}`

export const parseCellKey = (key: string) => {
    const match = /^([A-Z]+)(\d+)$/i.exec(key)
    if (!match) return null
    return { row: Number(match[2]) - 1, col: columnIndex(match[1]) }
}

export const rangeKeys = (start: string, end: string) => {
    const a = parseCellKey(start)
    const b = parseCellKey(end)
    if (!a || !b) return []
    const keys: string[] = []
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
        for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col += 1) {
            keys.push(cellKey(row, col))
        }
    }
    return keys
}

type Token = { type: 'number' | 'string' | 'word' | 'operator' | 'comma' | 'colon' | 'lparen' | 'rparen'; value: string }

const tokenize = (expression: string) => {
    const tokens: Token[] = []
    let index = 0
    while (index < expression.length) {
        const rest = expression.slice(index)
        const whitespace = /^\s+/.exec(rest)
        if (whitespace) { index += whitespace[0].length; continue }
        const number = /^(?:\d+\.?\d*|\.\d+)/.exec(rest)
        if (number) { tokens.push({ type: 'number', value: number[0] }); index += number[0].length; continue }
        const string = /^"((?:[^"]|"")*)"/.exec(rest)
        if (string) { tokens.push({ type: 'string', value: string[1].replace(/""/g, '"') }); index += string[0].length; continue }
        const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
        if (word) { tokens.push({ type: 'word', value: word[0].toUpperCase() }); index += word[0].length; continue }
        const pair = rest.slice(0, 2)
        if (['>=', '<=', '<>', '!='].includes(pair)) { tokens.push({ type: 'operator', value: pair }); index += 2; continue }
        const char = rest[0]
        const types: Record<string, Token['type']> = { ',': 'comma', ':': 'colon', '(': 'lparen', ')': 'rparen' }
        if (types[char]) tokens.push({ type: types[char], value: char })
        else if ('+-*/^&=><'.includes(char)) tokens.push({ type: 'operator', value: char })
        else throw new Error(`无法识别 ${char}`)
        index += 1
    }
    return tokens
}

const asNumber = (value: CellValue): number => {
    if (typeof value === 'number') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value.trim() === '') return 0
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error('不是数字')
    return number
}

const flatten = (values: unknown[]): CellValue[] => values.flat(Infinity).filter(value =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
) as CellValue[]

export const evaluateSpreadsheet = (data: SpreadsheetData) => {
    const cache: Record<string, CellValue> = {}
    const visiting = new Set<string>()

    const evaluateCell = (key: string): CellValue => {
        if (key in cache) return cache[key]
        if (visiting.has(key)) return '#CYCLE!'
        visiting.add(key)
        const raw = data.cells[key] ?? ''
        let value: CellValue = raw
        if (raw.startsWith('=')) {
            try {
                value = parseFormula(raw.slice(1), evaluateCell)
            } catch (error) {
                value = error instanceof Error && error.message === '除数为零' ? '#DIV/0!' : '#ERROR!'
            }
        } else if (raw !== '' && Number.isFinite(Number(raw))) {
            value = Number(raw)
        }
        visiting.delete(key)
        cache[key] = value
        return value
    }

    Object.keys(data.cells).forEach(evaluateCell)
    return { values: cache, get: evaluateCell }
}

const parseFormula = (expression: string, getCell: (key: string) => CellValue): CellValue => {
    const tokens = tokenize(expression)
    let position = 0
    const peek = () => tokens[position]
    const take = () => tokens[position++]
    const match = (type: Token['type'], value?: string) => {
        const token = peek()
        if (!token || token.type !== type || (value !== undefined && token.value !== value)) return false
        position += 1
        return true
    }

    const primary = (): CellValue | CellValue[] => {
        const token = take()
        if (!token) throw new Error('表达式不完整')
        if (token.type === 'number') return Number(token.value)
        if (token.type === 'string') return token.value
        if (token.type === 'lparen') {
            const value = comparison()
            if (!match('rparen')) throw new Error('缺少右括号')
            return value
        }
        if (token.type !== 'word') throw new Error('无效表达式')
        if (token.value === 'TRUE') return true
        if (token.value === 'FALSE') return false
        if (match('lparen')) {
            const args: Array<CellValue | CellValue[]> = []
            if (!match('rparen')) {
                do {
                    args.push(comparison())
                } while (match('comma'))
                if (!match('rparen')) throw new Error('缺少右括号')
            }
            return callFunction(token.value, args)
        }
        if (/^[A-Z]+\d+$/.test(token.value)) {
            if (match('colon')) {
                const end = take()
                if (!end || end.type !== 'word' || !/^[A-Z]+\d+$/.test(end.value)) throw new Error('范围无效')
                return rangeKeys(token.value, end.value).map(getCell)
            }
            return getCell(token.value)
        }
        throw new Error('未知名称')
    }

    const unary = (): CellValue | CellValue[] => {
        if (match('operator', '-')) return -asNumber(unary() as CellValue)
        if (match('operator', '+')) return asNumber(unary() as CellValue)
        return primary()
    }

    const power = (): CellValue => {
        let left = unary() as CellValue
        while (match('operator', '^')) left = asNumber(left) ** asNumber(unary() as CellValue)
        return left
    }

    const multiply = (): CellValue => {
        let left = power()
        while (peek()?.type === 'operator' && ['*', '/'].includes(peek().value)) {
            const operator = take().value
            const right = asNumber(power())
            if (operator === '/' && right === 0) throw new Error('除数为零')
            left = operator === '*' ? asNumber(left) * right : asNumber(left) / right
        }
        return left
    }

    const add = (): CellValue => {
        let left = multiply()
        while (peek()?.type === 'operator' && ['+', '-', '&'].includes(peek().value)) {
            const operator = take().value
            const right = multiply()
            if (operator === '&') left = String(left) + String(right)
            else left = operator === '+' ? asNumber(left) + asNumber(right) : asNumber(left) - asNumber(right)
        }
        return left
    }

    const comparison = (): CellValue => {
        let left = add()
        while (peek()?.type === 'operator' && ['=', '>', '<', '>=', '<=', '<>', '!='].includes(peek().value)) {
            const operator = take().value
            const right = add()
            if (operator === '=') left = left === right
            if (operator === '>' ) left = left > right
            if (operator === '<') left = left < right
            if (operator === '>=') left = left >= right
            if (operator === '<=') left = left <= right
            if (operator === '<>' || operator === '!=') left = left !== right
        }
        return left
    }

    const callFunction = (name: string, args: Array<CellValue | CellValue[]>): CellValue => {
        if (name === 'IF') return args[0] ? (args[1] as CellValue ?? '') : (args[2] as CellValue ?? '')
        const values = flatten(args)
        const numbers = values.map(value => {
            try { return asNumber(value) } catch { return null }
        }).filter((value): value is number => value !== null)
        if (name === 'SUM') return numbers.reduce((sum, value) => sum + value, 0)
        if (name === 'AVERAGE' || name === 'AVG') return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0
        if (name === 'MIN') return numbers.length ? Math.min(...numbers) : 0
        if (name === 'MAX') return numbers.length ? Math.max(...numbers) : 0
        if (name === 'COUNT') return numbers.length
        if (name === 'COUNTA') return values.filter(value => value !== '').length
        if (name === 'ROUND') return Number(asNumber(args[0] as CellValue).toFixed(asNumber(args[1] as CellValue || 0)))
        if (name === 'ABS') return Math.abs(asNumber(args[0] as CellValue))
        if (name === 'CONCAT') return values.join('')
        throw new Error('未知函数')
    }

    const value = comparison()
    if (position !== tokens.length || Array.isArray(value)) throw new Error('表达式无效')
    return value
}

export const formatCellValue = (value: CellValue, style?: CellStyle) => {
    if (typeof value !== 'number') return String(value)
    if (style?.format === 'percent') return `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
    if (style?.format === 'currency') return value.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
    if (style?.format === 'date') {
        const date = new Date(Math.round((value - 25569) * 86400 * 1000))
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('zh-CN')
    }
    if (style?.format === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 8 })
    return String(value)
}

export const parseDelimited = (text: string) => {
    const delimiter = text.includes('\t') ? '\t' : ','
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]
        if (char === '"') {
            if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 }
            else quoted = !quoted
        } else if (char === delimiter && !quoted) {
            row.push(cell); cell = ''
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && text[index + 1] === '\n') index += 1
            row.push(cell); rows.push(row); row = []; cell = ''
        } else cell += char
    }
    row.push(cell)
    if (row.some(value => value !== '') || !rows.length) rows.push(row)
    return rows
}

export const toCsv = (data: SpreadsheetData, values: Record<string, CellValue>) => {
    const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    return Array.from({ length: data.rows }, (_, row) =>
        Array.from({ length: data.cols }, (_, col) => escape(String(values[cellKey(row, col)] ?? ''))).join(',')
    ).join('\n')
}
