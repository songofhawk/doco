import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ImageComponent } from './ImageComponent'

export const ResizableImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            attachmentId: {
                default: null,
                parseHTML: (el) => el.getAttribute('data-attachment-id'),
                renderHTML: (attrs) => attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId } : {},
            },
            width: {
                default: null,
                parseHTML: (el) => {
                    const width = el.getAttribute('width') || el.style.width
                    return width ? parseInt(width, 10) : null
                },
                renderHTML: (attrs) => {
                    if (!attrs.width) return {}
                    return { width: attrs.width, style: `width: ${attrs.width}px` }
                },
            },
            height: {
                default: null,
                parseHTML: (el) => el.getAttribute('height') ? parseInt(el.getAttribute('height')!, 10) : null,
                renderHTML: (attrs) => attrs.height ? { height: attrs.height } : {},
            },
            align: {
                default: 'left',
                parseHTML: (el) => el.getAttribute('data-align') || 'left',
                renderHTML: (attrs) => {
                    return { 'data-align': attrs.align || 'left' }
                },
            },
        }
    },

    addNodeView() {
        return ReactNodeViewRenderer(ImageComponent as any)
    },
})
