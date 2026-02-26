import { useContext } from 'react'
import { ColorModeContext, type ColorModeContextType } from '../contexts/ColorModeContext'

export function useColorMode(): ColorModeContextType {
  const context = useContext(ColorModeContext)
  if (!context) {
    throw new Error('useColorMode must be used within a ColorModeProvider')
  }
  return context
}
