export type UploadedEditorImage = {
    id?: string
    src: string
}

export type EditorImageUploader = (file: File) => Promise<UploadedEditorImage>

export function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
        reader.readAsDataURL(file)
    })
}

export const embedEditorImage: EditorImageUploader = async (file) => ({
    src: await fileToDataUrl(file),
})

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
