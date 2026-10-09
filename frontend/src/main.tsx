import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { applyTheme, savedTheme } from './lib/theme.ts'
import Home from './pages/Home.tsx'
import PayPage from './pages/PayPage.tsx'

applyTheme(savedTheme())

// Two routes only ("/" and "/pay/:orderId"), so no router dependency.
const pay = window.location.pathname.match(/^\/pay\/([^/]+)\/?$/)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{pay ? <PayPage orderId={decodeURIComponent(pay[1])} /> : <Home />}</StrictMode>,
)
