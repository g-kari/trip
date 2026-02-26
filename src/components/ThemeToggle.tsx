import { useState, useRef, useEffect } from 'react'
import { useColorMode } from '../hooks/useColorMode'
import type { ColorMode } from '../contexts/ColorModeContext'

const modes: { value: ColorMode; icon: string; label: string }[] = [
  { value: 'light', icon: '☀', label: 'ライトモード' },
  { value: 'dark', icon: '☾', label: 'ダークモード' },
  { value: 'system', icon: '◐', label: 'システム設定' },
]

export function ThemeToggle() {
  const { colorMode, setColorMode } = useColorMode()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentMode = modes.find((m) => m.value === colorMode) || modes[2]

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="theme-toggle-dropdown" ref={dropdownRef}>
      <button
        className="theme-toggle-icon-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={currentMode.label}
        aria-expanded={isOpen}
      >
        {currentMode.icon}
      </button>
      {isOpen && (
        <div className="theme-toggle-menu">
          {modes.map((mode) => (
            <button
              key={mode.value}
              className={`theme-toggle-menu-item ${colorMode === mode.value ? 'active' : ''}`}
              onClick={() => {
                setColorMode(mode.value)
                setIsOpen(false)
              }}
            >
              <span className="theme-toggle-menu-icon">{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
