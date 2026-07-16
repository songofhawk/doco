import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { SpreadsheetEditor } from './components/SpreadsheetComponent'
import { createSpreadsheetData, normalizeSpreadsheetData, type SpreadsheetData } from './components/spreadsheetEngine'

type StandaloneSpreadsheetPageProps = {
    docId: string
    userId: string
    title: string
    websocketUrl: string
    onTitleChange: (title: string) => void
}

export const StandaloneSpreadsheetPage = ({
    docId,
    userId,
    title: initialTitle,
    websocketUrl,
    onTitleChange,
}: StandaloneSpreadsheetPageProps) => {
    const [title, setTitle] = useState(initialTitle)
    const [data, setData] = useState<SpreadsheetData>(() => createSpreadsheetData())
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [ydoc] = useState(() => new Y.Doc())
    const sheetMap = useMemo(() => ydoc.getMap<unknown>('spreadsheet'), [ydoc])
    const undoManager = useMemo(() => new Y.UndoManager(sheetMap), [sheetMap])
    const providerRef = useRef<HocuspocusProvider | null>(null)
    const saveRequestRef = useRef<string | null>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const titleTimerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => setTitle(initialTitle), [initialTitle])

    useEffect(() => {
        const syncFromMap = () => {
            const stored = sheetMap.get('data')
            if (stored) setData(normalizeSpreadsheetData(stored))
        }
        syncFromMap()
        sheetMap.observe(syncFromMap)
        return () => sheetMap.unobserve(syncFromMap)
    }, [sheetMap])

    useEffect(() => {
        const idb = new IndexeddbPersistence(`doco-sheet-${userId}-${docId}`, ydoc)
        let disposed = false
        let connectTimer: ReturnType<typeof setTimeout> | undefined
        const socket = new HocuspocusProviderWebsocket({ url: websocketUrl, autoConnect: false })
        const provider = new HocuspocusProvider({
            websocketProvider: socket,
            name: docId,
            document: ydoc,
            onSynced: () => {
                if (!sheetMap.has('data')) {
                    ydoc.transact(() => sheetMap.set('data', createSpreadsheetData()), 'doco:spreadsheet-initialize')
                }
            },
            onStateless: ({ payload }) => {
                let message: { type?: string; requestId?: string; ok?: boolean }
                try { message = JSON.parse(payload) } catch { return }
                if (message.type !== 'doco:save-result' || message.requestId !== saveRequestRef.current) return
                saveRequestRef.current = null
                clearTimeout(saveTimerRef.current)
                setSaveStatus(message.ok ? 'saved' : 'error')
                saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
            },
        })
        provider.attach()
        providerRef.current = provider

        idb.once('synced', () => {
            if (disposed) return
            const stored = sheetMap.get('data')
            if (stored) setData(normalizeSpreadsheetData(stored))
            connectTimer = setTimeout(() => {
                if (!disposed) socket.connect()
            }, 0)
        })

        return () => {
            disposed = true
            if (connectTimer) clearTimeout(connectTimer)
            if (providerRef.current === provider) providerRef.current = null
            provider.destroy()
            socket.destroy()
            idb.destroy()
        }
    }, [docId, sheetMap, userId, websocketUrl, ydoc])

    const updateData = useCallback((next: SpreadsheetData) => {
        setData(next)
        ydoc.transact(() => sheetMap.set('data', next), 'doco:spreadsheet-edit')
    }, [sheetMap, ydoc])

    const requestSave = useCallback(() => {
        const provider = providerRef.current
        clearTimeout(saveTimerRef.current)
        if (!provider?.synced) {
            setSaveStatus('error')
            saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
            return
        }
        const requestId = crypto.randomUUID()
        saveRequestRef.current = requestId
        setSaveStatus('saving')
        provider.sendStateless(JSON.stringify({ type: 'doco:save', requestId }))
        saveTimerRef.current = setTimeout(() => {
            if (saveRequestRef.current !== requestId) return
            saveRequestRef.current = null
            setSaveStatus('error')
            saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
        }, 5000)
    }, [])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 's') return
            event.preventDefault()
            requestSave()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            clearTimeout(saveTimerRef.current)
            clearTimeout(titleTimerRef.current)
        }
    }, [requestSave])

    const changeTitle = (value: string) => {
        setTitle(value)
        clearTimeout(titleTimerRef.current)
        titleTimerRef.current = setTimeout(() => onTitleChange(value), 600)
    }

    return (
        <div className="doco-editor-root standalone-spreadsheet-page">
            <SpreadsheetEditor
                standalone
                data={data}
                title={title}
                saveStatus={saveStatus}
                onChange={updateData}
                onTitleChange={changeTitle}
                onUndo={() => undoManager.undo()}
                onRedo={() => undoManager.redo()}
            />
        </div>
    )
}
