import { useColorMode } from '../hooks/useColorMode'
import type { ColorMode } from '../contexts/ColorModeContext'

const modes: { value: ColorMode; label: string }[] = [
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
  { value: 'system', label: 'システム' },
]

export function ThemeToggle() {
  const { colorMode, setColorMode } = useColorMode()

  return (
    <div className="theme-toggle">
      {modes.map((mode) => (
        <button
          key={mode.value}
          className={`theme-toggle-btn ${colorMode === mode.value ? 'active' : ''}`}
          onClick={() => setColorMode(mode.value)}
          aria-pressed={colorMode === mode.value}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}
