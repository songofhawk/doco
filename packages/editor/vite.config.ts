import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        'react', 'react-dom', 'react/jsx-runtime',
        /^@tiptap\//,
        'yjs', 'y-websocket', 'y-indexeddb',
      ],
      output: {
        assetFileNames: 'style.[ext]',
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'yjs'],
  },
})
