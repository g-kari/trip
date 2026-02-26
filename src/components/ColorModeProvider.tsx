import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { ColorModeContext, type ColorMode, type ResolvedColorMode } from '../contexts/ColorModeContext'

const STORAGE_KEY = 'color-mode'

function getSystemPreference(): ResolvedColorMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredColorMode(): ColorMode {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

// Initialize document attribute before React renders
function initializeColorMode(): ColorMode {
  const mode = getStoredColorMode()
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-color-mode', mode)
  }
  return mode
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [colorMode, setColorModeState] = useState<ColorMode>(initializeColorMode)
  const [systemPreference, setSystemPreference] = useState<ResolvedColorMode>(getSystemPreference)

  // Calculate resolved mode based on colorMode and system preference
  const resolvedMode = useMemo<ResolvedColorMode>(() => {
    if (colorMode === 'system') {
      return systemPreference
    }
    return colorMode
  }, [colorMode, systemPreference])

  // Set color mode and persist to localStorage
  const setColorMode = useCallback((mode: ColorMode) => {
    setColorModeState(mode)
    localStorage.setItem(STORAGE_KEY, mode)
    document.documentElement.setAttribute('data-color-mode', mode)
  }, [])

  // Toggle between light and dark
  const toggleColorMode = useCallback(() => {
    const newMode = resolvedMode === 'light' ? 'dark' : 'light'
    setColorMode(newMode)
  }, [resolvedMode, setColorMode])

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPreference(e.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return (
    <ColorModeContext.Provider value={{ colorMode, resolvedMode, setColorMode, toggleColorMode }}>
      {children}
    </ColorModeContext.Provider>
  )
}
