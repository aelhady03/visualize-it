import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Recursive, all axes (wght, MONO, CASL, slnt): one family, three voices.
import '@fontsource-variable/recursive/full.css'
// Tailwind + the design tokens (index.css imports core/theme/theme.css).
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
