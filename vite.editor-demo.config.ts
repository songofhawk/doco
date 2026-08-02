import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const entry = new URL('./editor-demo.html', import.meta.url).pathname

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    watch: {
      ignored: ['**/dist-editor/**', '**/dist-editor-demo/**'],
    },
  },
  build: {
    outDir: 'dist-editor-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: entry,
    },
  },
})
