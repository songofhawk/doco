import { API_BASE, apiFetch } from '../auth'

export type UploadedImage = {
    id: string
    src: string
}

export async function uploadEditorImage(file: File, docId: string): Promise<UploadedImage> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('document_id', docId)

    const response = await apiFetch('/attachments/upload', {
        method: 'POST',
        body: formData,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || '图片上传失败')

    return {
        id: body.id,
        src: `${API_BASE}/attachments/${body.id}`,
    }
}

export function pastedGifSource(html: string): string | null {
    if (!html) return null
    const document = new DOMParser().parseFromString(html, 'text/html')
    for (const image of document.querySelectorAll('img[src]')) {
        const src = image.getAttribute('src') || ''
        if (/^data:image\/gif(?:;|,)/i.test(src) || /\.gif(?:$|[?#])/i.test(src)) return src
    }
    return null
}

export async function gifFileFromSource(src: string): Promise<File> {
    const response = await fetch(src)
    if (!response.ok) throw new Error('无法读取粘贴的 GIF')
    const blob = await response.blob()
    if (blob.type && blob.type !== 'image/gif') throw new Error('粘贴内容不是 GIF')
    return new File([blob], 'pasted.gif', { type: 'image/gif' })
}
