import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorDemo } from './EditorDemo'
import './editorDemo.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorDemo />
  </StrictMode>,
)
