import { createContext } from 'react'

export type ColorMode = 'light' | 'dark' | 'system'
export type ResolvedColorMode = 'light' | 'dark'

export interface ColorModeContextType {
  /** Current color mode setting ('light' | 'dark' | 'system') */
  colorMode: ColorMode
  /** Actual displayed mode after resolving 'system' preference */
  resolvedMode: ResolvedColorMode
  /** Set the color mode */
  setColorMode: (mode: ColorMode) => void
  /** Toggle between light and dark (ignores system) */
  toggleColorMode: () => void
}

export const ColorModeContext = createContext<ColorModeContextType | null>(null)
