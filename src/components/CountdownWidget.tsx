import { useState, useEffect, useMemo } from 'react'

type CountdownMode = 'countdown' | 'traveling' | 'ended'

type CountdownState = {
  mode: CountdownMode
  days: number
  hours: number
  minutes: number
  seconds: number
  daysSinceEnd: number
}

type Props = {
  startDate: string | null
  endDate: string | null
  compact?: boolean  // true for card display, false for full display
}

function getJSTNow(): Date {
  const now = new Date()
  const jstOffset = 9 * 60 * 60 * 1000
  return new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60 * 1000)
}

function parseDate(dateStr: string): Date {
  // Parse YYYY-MM-DD format as JST start of day
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function computeCountdownState(startDate: string, endDate: string | null): CountdownState {
  const now = getJSTNow()
  const start = parseDate(startDate)
  const end = endDate ? parseDate(endDate) : start
  const tripEndTime = new Date(end.getTime() + 24 * 60 * 60 * 1000) // End of last day

  // Check if trip has ended (after end date)
  if (now >= tripEndTime) {
    const diff = now.getTime() - tripEndTime.getTime()
    const daysSinceEnd = Math.floor(diff / (1000 * 60 * 60 * 24))
    return {
      mode: 'ended',
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      daysSinceEnd,
    }
  }

  // Check if currently traveling (between start and end dates inclusive)
  if (now >= start && now < tripEndTime) {
    return {
      mode: 'traveling',
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      daysSinceEnd: 0,
    }
  }

  // Trip is in the future - show countdown
  const diff = start.getTime() - now.getTime()
  const seconds = Math.floor((diff / 1000) % 60)
  const minutes = Math.floor((diff / (1000 * 60)) % 60)
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24)
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  return {
    mode: 'countdown',
    days,
    hours,
    minutes,
    seconds,
    daysSinceEnd: 0,
  }
}

function CountdownWidgetInner({ startDate, endDate, compact = false }: { startDate: string; endDate: string | null; compact?: boolean }) {
  // Compute initial state synchronously using useMemo
  const initialState = useMemo(() => computeCountdownState(startDate, endDate), [startDate, endDate])
  const [state, setState] = useState<CountdownState>(initialState)

  // Update countdown every second via interval
  useEffect(() => {
    const interval = setInterval(() => {
      setState(computeCountdownState(startDate, endDate))
    }, 1000)

    return () => clearInterval(interval)
  }, [startDate, endDate])

  const { mode, days, hours, minutes, seconds, daysSinceEnd } = state

  // Traveling mode
  if (mode === 'traveling') {
    return (
      <div className={`countdown-widget countdown-traveling ${compact ? 'countdown-compact' : ''}`}>
        <span className="countdown-badge countdown-badge-traveling">旅行中!</span>
      </div>
    )
  }

  // Ended mode
  if (mode === 'ended') {
    if (compact) {
      // In compact mode, hide old trips or show minimal indicator
      if (daysSinceEnd > 30) {
        return null
      }
      return (
        <div className="countdown-widget countdown-ended countdown-compact">
          <span className="countdown-text-small">{daysSinceEnd}日前に終了</span>
        </div>
      )
    }
    return (
      <div className="countdown-widget countdown-ended">
        <span className="countdown-badge countdown-badge-ended">旅行終了</span>
        <span className="countdown-text-muted">{daysSinceEnd}日前</span>
      </div>
    )
  }

  // Countdown mode
  // Compact mode for trip cards
  if (compact) {
    if (days === 0 && hours === 0 && minutes === 0) {
      return (
        <div className="countdown-widget countdown-compact countdown-imminent">
          <span className="countdown-badge countdown-badge-imminent">もうすぐ!</span>
        </div>
      )
    }

    if (days === 0) {
      return (
        <div className="countdown-widget countdown-compact countdown-today">
          <span className="countdown-text-compact">
            あと<span className="countdown-number">{hours}</span>時間
            <span className="countdown-number">{minutes}</span>分
          </span>
        </div>
      )
    }

    return (
      <div className="countdown-widget countdown-compact">
        <span className="countdown-text-compact">
          あと<span className="countdown-number">{days}</span>日
        </span>
      </div>
    )
  }

  // Full mode for trip detail page
  if (days === 0 && hours === 0 && minutes === 0) {
    return (
      <div className="countdown-widget countdown-full countdown-imminent">
        <span className="countdown-badge countdown-badge-imminent">まもなく出発!</span>
      </div>
    )
  }

  return (
    <div className="countdown-widget countdown-full">
      <div className="countdown-label">旅行まで</div>
      <div className="countdown-values">
        {days > 0 && (
          <div className="countdown-unit">
            <span className="countdown-value">{days}</span>
            <span className="countdown-unit-label">日</span>
          </div>
        )}
        <div className="countdown-unit">
          <span className="countdown-value">{hours}</span>
          <span className="countdown-unit-label">時間</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{minutes}</span>
          <span className="countdown-unit-label">分</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{seconds}</span>
          <span className="countdown-unit-label">秒</span>
        </div>
      </div>
    </div>
  )
}

export function CountdownWidget({ startDate, endDate, compact = false }: Props) {
  // Don't render if no start date
  if (!startDate) {
    return null
  }

  // Use key to force remount when props change - this ensures initialState is recomputed
  return <CountdownWidgetInner key={`${startDate}-${endDate}`} startDate={startDate} endDate={endDate} compact={compact} />
}
