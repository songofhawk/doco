import type { JSONContent } from '@tiptap/core'

const DATABASE_NAME = 'doco-text-editor-demo'
const STORE_NAME = 'documents'
const DOCUMENT_KEY = 'browser-only-document'

export interface BrowserDocument {
  json: JSONContent
  updatedAt: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开浏览器存储'))
  })
}

export async function readBrowserDocument(): Promise<BrowserDocument | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(DOCUMENT_KEY)

    request.onsuccess = () => resolve((request.result as BrowserDocument | undefined) || null)
    request.onerror = () => reject(request.error || new Error('无法读取浏览器文档'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error('读取浏览器文档失败'))
    }
  })
}

export async function writeBrowserDocument(json: JSONContent): Promise<BrowserDocument> {
  const database = await openDatabase()
  const document = { json, updatedAt: new Date().toISOString() }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(document, DOCUMENT_KEY)

    transaction.oncomplete = () => {
      database.close()
      resolve(document)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error('保存浏览器文档失败'))
    }
  })
}
