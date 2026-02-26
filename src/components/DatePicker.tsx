import { useState, useRef, useEffect, useCallback } from 'react'

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  min?: string
  max?: string
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const MONTHS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月'
]

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

function formatDateJP(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = WEEKDAYS[date.getDay()]
  return `${year}/${month}/${day} (${weekday})`
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

function isDateInRange(date: Date, min?: string, max?: string): boolean {
  if (min) {
    const minDate = new Date(min)
    minDate.setHours(0, 0, 0, 0)
    if (date < minDate) return false
  }
  if (max) {
    const maxDate = new Date(max)
    maxDate.setHours(23, 59, 59, 999)
    if (date > maxDate) return false
  }
  return true
}

export function DatePicker({
  value,
  onChange,
  placeholder = '日付を選択',
  className = '',
  min,
  max,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => {
    if (value) return new Date(value)
    return new Date()
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLButtonElement>(null)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
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
        inputRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Position calendar to prevent overflow
  const positionCalendar = useCallback(() => {
    if (!calendarRef.current || !containerRef.current) return

    const calendar = calendarRef.current
    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const calendarHeight = calendar.offsetHeight
    const calendarWidth = calendar.offsetWidth
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // Reset position
    calendar.style.top = ''
    calendar.style.bottom = ''
    calendar.style.left = ''
    calendar.style.right = ''

    // Check vertical position
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top

    if (spaceBelow < calendarHeight && spaceAbove > spaceBelow) {
      // Show above
      calendar.style.bottom = '100%'
      calendar.style.marginBottom = '4px'
    } else {
      // Show below
      calendar.style.top = '100%'
      calendar.style.marginTop = '4px'
    }

    // Check horizontal position
    const spaceRight = viewportWidth - rect.left
    if (spaceRight < calendarWidth) {
      calendar.style.right = '0'
    } else {
      calendar.style.left = '0'
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      positionCalendar()
      window.addEventListener('resize', positionCalendar)
      window.addEventListener('scroll', positionCalendar, true)
      return () => {
        window.removeEventListener('resize', positionCalendar)
        window.removeEventListener('scroll', positionCalendar, true)
      }
    }
  }, [isOpen, positionCalendar])

  function handleToggle() {
    setIsOpen(!isOpen)
    if (!isOpen && value) {
      setViewDate(new Date(value))
    } else if (!isOpen) {
      setViewDate(new Date())
    }
  }

  function handlePrevMonth() {
    setViewDate(prev => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() - 1)
      return newDate
    })
  }

  function handleNextMonth() {
    setViewDate(prev => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() + 1)
      return newDate
    })
  }

  function handlePrevYear() {
    setViewDate(prev => {
      const newDate = new Date(prev)
      newDate.setFullYear(newDate.getFullYear() - 1)
      return newDate
    })
  }

  function handleNextYear() {
    setViewDate(prev => {
      const newDate = new Date(prev)
      newDate.setFullYear(newDate.getFullYear() + 1)
      return newDate
    })
  }

  function handleSelectDate(day: number) {
    const selected = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
    if (!isDateInRange(selected, min, max)) return

    const year = selected.getFullYear()
    const month = String(selected.getMonth() + 1).padStart(2, '0')
    const dayStr = String(day).padStart(2, '0')
    onChange(`${year}-${month}-${dayStr}`)
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function handleGoToToday() {
    const now = new Date()
    setViewDate(now)
    if (isDateInRange(now, min, max)) {
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      onChange(`${year}-${month}-${day}`)
    }
  }

  function handleClear() {
    onChange('')
    setIsOpen(false)
  }

  // Keyboard navigation
  function handleCalendarKeyDown(e: React.KeyboardEvent) {
    const currentDate = value ? new Date(value) : new Date()

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        currentDate.setDate(currentDate.getDate() - 1)
        break
      case 'ArrowRight':
        e.preventDefault()
        currentDate.setDate(currentDate.getDate() + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        currentDate.setDate(currentDate.getDate() - 7)
        break
      case 'ArrowDown':
        e.preventDefault()
        currentDate.setDate(currentDate.getDate() + 7)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (value) {
          setIsOpen(false)
          inputRef.current?.focus()
        }
        return
      default:
        return
    }

    if (isDateInRange(currentDate, min, max)) {
      const year = currentDate.getFullYear()
      const month = String(currentDate.getMonth() + 1).padStart(2, '0')
      const day = String(currentDate.getDate()).padStart(2, '0')
      onChange(`${year}-${month}-${day}`)
      setViewDate(currentDate)
    }
  }

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  const selectedDate = value ? new Date(value) : null

  // Generate calendar grid
  const calendarDays: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null)
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day)
  }

  return (
    <div ref={containerRef} className={`date-picker ${className}`}>
      <button
        ref={inputRef}
        type="button"
        className="date-picker-input"
        onClick={handleToggle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={value ? 'date-picker-value' : 'date-picker-placeholder'}>
          {value ? formatDateJP(value) : placeholder}
        </span>
        <span className="date-picker-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 1V3M11 1V3M2 5H14M3 2H13C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          ref={calendarRef}
          className="date-picker-calendar"
          role="dialog"
          aria-label="カレンダー"
          onKeyDown={handleCalendarKeyDown}
        >
          {/* Header with navigation */}
          <div className="calendar-header">
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={handlePrevYear}
              aria-label="前年"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8 10L4 6L8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 10L1 6L5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={handlePrevMonth}
              aria-label="前月"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8 10L4 6L8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <span className="calendar-title">
              {year}年 {MONTHS[month]}
            </span>
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={handleNextMonth}
              aria-label="次月"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={handleNextYear}
              aria-label="次年"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 2L11 6L7 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Weekday headers */}
          <div className="calendar-weekdays">
            {WEEKDAYS.map((day, i) => (
              <span
                key={day}
                className={`calendar-weekday ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}
              >
                {day}
              </span>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="calendar-grid" role="grid">
            {calendarDays.map((day, index) => {
              if (day === null) {
                return <span key={`empty-${index}`} className="calendar-day empty" />
              }

              const dateObj = new Date(year, month, day)
              const isToday = isSameDay(dateObj, today)
              const isSelected = selectedDate && isSameDay(dateObj, selectedDate)
              const dayOfWeek = dateObj.getDay()
              const isSunday = dayOfWeek === 0
              const isSaturday = dayOfWeek === 6
              const isDisabled = !isDateInRange(dateObj, min, max)

              return (
                <button
                  key={day}
                  type="button"
                  className={`calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${isDisabled ? 'disabled' : ''}`}
                  onClick={() => handleSelectDate(day)}
                  disabled={isDisabled}
                  tabIndex={isSelected ? 0 : -1}
                  aria-selected={isSelected || undefined}
                  aria-label={`${year}年${month + 1}月${day}日${isToday ? ' (今日)' : ''}`}
                >
                  {day}
                </button>
              )
            })}
          </div>

          {/* Footer actions */}
          <div className="calendar-footer">
            <button
              type="button"
              className="calendar-footer-btn"
              onClick={handleGoToToday}
            >
              今日
            </button>
            <button
              type="button"
              className="calendar-footer-btn"
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
