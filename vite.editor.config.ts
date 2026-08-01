import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'

const entry = new URL('./src/editor/standalone.ts', import.meta.url).pathname

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({
      entryRoot: 'src/editor',
      include: ['src/editor'],
      outDir: 'dist-editor',
      rollupTypes: true,
      tsconfigPath: 'tsconfig.app.json',
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist-editor',
    emptyOutDir: true,
    lib: {
      entry,
      formats: ['es'],
      fileName: 'doco-text-editor',
      cssFileName: 'doco-text-editor',
    },
    rollupOptions: {
      external: (id) => id === 'react' || id.startsWith('react/') || id === 'react-dom' || id.startsWith('react-dom/'),
    },
  },
})
