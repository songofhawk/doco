import { API_BASE, apiFetch } from '../auth'
export { gifFileFromSource, pastedGifSource } from './imageUtils'
export type { EditorImageUploader, UploadedEditorImage } from './imageUtils'

export type UploadedImage = {
    id: string
    src: string
}

export function resolveDocoImageSrc(src: string, attachmentId?: string | null) {
    return attachmentId ? `${API_BASE}/attachments/${attachmentId}` : src
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
        src: resolveDocoImageSrc('', body.id),
    }
}
