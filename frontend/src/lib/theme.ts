import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'flowq-theme'

/** Dark unless the person explicitly chose light in this browser. */
export function savedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0a0b' : '#f8f9fa')
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(savedTheme)

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // preference just won't persist
    }
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}
