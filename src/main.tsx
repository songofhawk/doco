import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const storedAppearance = window.localStorage.getItem('doco-appearance-theme')
document.documentElement.dataset.theme = storedAppearance === 'paper' ? 'paper' : 'simple'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
