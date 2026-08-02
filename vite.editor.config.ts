import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { readFileSync } from 'node:fs'

const entry = new URL('./src/editor/standalone.ts', import.meta.url).pathname
const packageReadme = readFileSync(new URL('./src/editor/README.md', import.meta.url), 'utf8')
const packageLicense = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8')

const dependencies = {
  '@radix-ui/react-popover': '^1.1.15',
  '@tiptap/core': '^3.20.0',
  '@tiptap/extension-code-block-lowlight': '^3.20.0',
  '@tiptap/extension-color': '^3.20.0',
  '@tiptap/extension-highlight': '^3.20.0',
  '@tiptap/extension-image': '^3.20.0',
  '@tiptap/extension-placeholder': '^3.20.0',
  '@tiptap/extension-table': '^3.20.0',
  '@tiptap/extension-table-cell': '^3.20.0',
  '@tiptap/extension-table-header': '^3.20.0',
  '@tiptap/extension-table-row': '^3.20.0',
  '@tiptap/extension-task-item': '^3.20.0',
  '@tiptap/extension-task-list': '^3.20.0',
  '@tiptap/extension-text-align': '^3.20.0',
  '@tiptap/extension-text-style': '^3.20.0',
  '@tiptap/pm': '^3.20.0',
  '@tiptap/react': '^3.20.0',
  '@tiptap/starter-kit': '^3.20.0',
  '@tiptap/suggestion': '^3.20.0',
  'highlight.js': '^11.11.1',
  lowlight: '^3.3.0',
  'lucide-react': '^0.575.0',
  mermaid: '^11.12.3',
  'plantuml-encoder': '^1.4.0',
  'tippy.js': '^6.3.7',
  'tiptap-markdown': '^0.9.0',
  ulid: '^3.0.1',
}

const packageManifest = {
  name: 'doco-text-editor',
  version: '0.1.0',
  description: 'A standalone React rich-text editor powered by Tiptap, with tables, diagrams, callouts and spreadsheets.',
  type: 'module',
  license: 'MIT',
  main: './doco-text-editor.js',
  module: './doco-text-editor.js',
  types: './doco-text-editor.d.ts',
  exports: {
    '.': {
      types: './doco-text-editor.d.ts',
      import: './doco-text-editor.js',
    },
    './style.css': './style.css',
  },
  files: ['*.js', '*.d.ts', 'style.css', 'README.md', 'LICENSE'],
  sideEffects: ['*.css'],
  repository: {
    type: 'git',
    url: 'git+https://github.com/songofhawk/doco.git',
  },
  homepage: 'https://github.com/songofhawk/doco#readme',
  bugs: {
    url: 'https://github.com/songofhawk/doco/issues',
  },
  keywords: ['react', 'tiptap', 'editor', 'rich-text', 'mermaid', 'plantuml', 'spreadsheet'],
  publishConfig: {
    access: 'public',
  },
  peerDependencies: {
    react: '^18.0.0 || ^19.0.0',
    'react-dom': '^18.0.0 || ^19.0.0',
  },
  dependencies,
}

const externalPackages = new Set([
  ...Object.keys(dependencies),
  'react',
  'react-dom',
])

const isExternal = (id: string) => Array.from(externalPackages).some(
  packageName => id === packageName || id.startsWith(`${packageName}/`),
)

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
    {
      name: 'doco-editor-package-metadata',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'package.json',
          source: `${JSON.stringify(packageManifest, null, 2)}\n`,
        })
        this.emitFile({ type: 'asset', fileName: 'README.md', source: packageReadme })
        this.emitFile({ type: 'asset', fileName: 'LICENSE', source: packageLicense })
      },
    },
  ],
  publicDir: false,
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
      external: isExternal,
    },
  },
})
