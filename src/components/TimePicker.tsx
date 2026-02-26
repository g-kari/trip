import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react'

type TimePickerProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  interval?: number // minutes (default: 15)
  minTime?: string // HH:MM format
  maxTime?: string // HH:MM format
}

function generateTimeOptions(interval: number, minTime?: string, maxTime?: string): string[] {
  const options: string[] = []
  const minMinutes = minTime ? parseTimeToMinutes(minTime) : 0
  const maxMinutes = maxTime ? parseTimeToMinutes(maxTime) : 24 * 60 - 1

  for (let minutes = 0; minutes < 24 * 60; minutes += interval) {
    if (minutes >= minMinutes && minutes <= maxMinutes) {
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      options.push(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`)
    }
  }

  return options
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function formatTimeJP(time: string): string {
  if (!time) return ''
  const [hours, minutes] = time.split(':')
  const h = parseInt(hours, 10)
  const m = parseInt(minutes, 10)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function TimePicker({
  value,
  onChange,
  placeholder = '時刻を選択',
  className = '',
  interval = 15,
  minTime,
  maxTime,
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const timeOptions = useMemo(
    () => generateTimeOptions(interval, minTime, maxTime),
    [interval, minTime, maxTime]
  )

  const filteredOptions = useMemo(() => {
    if (!searchText) return timeOptions
    const searchLower = searchText.toLowerCase().replace(/[^0-9:]/g, '')
    return timeOptions.filter(time => time.includes(searchLower))
  }, [timeOptions, searchText])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setSearchText('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setSearchText('')
        inputRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  // Scroll to selected value when opened - using useLayoutEffect to avoid warning
  // This is intentional: we need to set the highlighted index when the dropdown opens
  useLayoutEffect(() => {
    if (isOpen && value && listRef.current) {
      const selectedIndex = filteredOptions.indexOf(value)
      if (selectedIndex >= 0) {
        // Using requestAnimationFrame to defer the state update
        requestAnimationFrame(() => {
          setHighlightedIndex(selectedIndex)
        })
        const item = listRef.current.children[selectedIndex] as HTMLElement
        if (item) {
          item.scrollIntoView({ block: 'center' })
        }
      }
    }
  }, [isOpen, value, filteredOptions])

  // Position dropdown to prevent overflow
  const positionDropdown = useCallback(() => {
    if (!dropdownRef.current || !containerRef.current) return

    const dropdown = dropdownRef.current
    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const dropdownHeight = dropdown.offsetHeight
    const dropdownWidth = dropdown.offsetWidth
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // Reset position
    dropdown.style.top = ''
    dropdown.style.bottom = ''
    dropdown.style.left = ''
    dropdown.style.right = ''

    // Check vertical position
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top

    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      // Show above
      dropdown.style.bottom = '100%'
      dropdown.style.marginBottom = '4px'
    } else {
      // Show below
      dropdown.style.top = '100%'
      dropdown.style.marginTop = '4px'
    }

    // Check horizontal position
    const spaceRight = viewportWidth - rect.left
    if (spaceRight < dropdownWidth) {
      dropdown.style.right = '0'
    } else {
      dropdown.style.left = '0'
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      positionDropdown()
      window.addEventListener('resize', positionDropdown)
      window.addEventListener('scroll', positionDropdown, true)
      return () => {
        window.removeEventListener('resize', positionDropdown)
        window.removeEventListener('scroll', positionDropdown, true)
      }
    }
  }, [isOpen, positionDropdown])

  function handleToggle() {
    setIsOpen(!isOpen)
    if (isOpen) {
      setSearchText('')
    }
  }

  function handleSelectTime(time: string) {
    onChange(time)
    setIsOpen(false)
    setSearchText('')
    inputRef.current?.focus()
  }

  function handleClear() {
    onChange('')
    setIsOpen(false)
    setSearchText('')
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          handleSelectTime(filteredOptions[highlightedIndex])
        } else if (filteredOptions.length === 1) {
          handleSelectTime(filteredOptions[0])
        }
        break
      case 'Tab':
        setIsOpen(false)
        setSearchText('')
        break
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [isOpen, highlightedIndex])

  // Quick time buttons
  const quickTimes = ['09:00', '12:00', '15:00', '18:00']

  return (
    <div ref={containerRef} className={`time-picker ${className}`}>
      <button
        ref={inputRef}
        type="button"
        className="time-picker-input"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={value ? 'time-picker-value' : 'time-picker-placeholder'}>
          {value ? formatTimeJP(value) : placeholder}
        </span>
        <span className="time-picker-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 4V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="time-picker-dropdown"
          role="listbox"
          aria-label="時刻選択"
        >
          {/* Search input */}
          <div className="time-picker-search">
            <input
              ref={searchInputRef}
              type="text"
              className="time-picker-search-input"
              placeholder="検索 (例: 10:30)"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value)
                setHighlightedIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
              aria-label="時刻を検索"
            />
          </div>

          {/* Quick time buttons */}
          <div className="time-picker-quick">
            {quickTimes.map(time => (
              <button
                key={time}
                type="button"
                className={`time-picker-quick-btn ${value === time ? 'selected' : ''}`}
                onClick={() => handleSelectTime(time)}
              >
                {formatTimeJP(time)}
              </button>
            ))}
          </div>

          {/* Time list */}
          <div ref={listRef} className="time-picker-list">
            {filteredOptions.length === 0 ? (
              <div className="time-picker-empty">
                該当する時刻がありません
              </div>
            ) : (
              filteredOptions.map((time, index) => (
                <button
                  key={time}
                  type="button"
                  className={`time-picker-option ${value === time ? 'selected' : ''} ${highlightedIndex === index ? 'highlighted' : ''}`}
                  onClick={() => handleSelectTime(time)}
                  role="option"
                  aria-selected={value === time}
                  tabIndex={-1}
                >
                  {formatTimeJP(time)}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="time-picker-footer">
            <button
              type="button"
              className="time-picker-footer-btn"
              onClick={handleClear}
            >
              クリア
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
