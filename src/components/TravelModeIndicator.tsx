import { useMemo } from 'react'
import type { Trip, Day } from '../types'

type Props = {
  trip: Trip
  onJumpToToday?: () => void
}

// Check if current date is within trip date range (in JST)
function isTraveling(startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false

  const now = new Date()
  // Convert to JST (UTC+9)
  const jstOffset = 9 * 60 * 60 * 1000
  const jstNow = new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60 * 1000)
  const today = jstNow.toISOString().split('T')[0]

  return today >= startDate && today <= endDate
}

// Get today's day ID if it exists
function getTodayDayId(days: Day[] | undefined): string | null {
  if (!days) return null
  const now = new Date()
  const jstOffset = 9 * 60 * 60 * 1000
  const jstNow = new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60 * 1000)
  const today = jstNow.toISOString().split('T')[0]

  const todayDay = days.find(day => day.date === today)
  return todayDay?.id ?? null
}

export function TravelModeIndicator({ trip, onJumpToToday }: Props) {
  const traveling = useMemo(() => {
    return isTraveling(trip.startDate, trip.endDate)
  }, [trip.startDate, trip.endDate])

  const todayDayId = useMemo(() => {
    return getTodayDayId(trip.days)
  }, [trip.days])

  const progress = useMemo(() => {
    if (!trip.items || trip.items.length === 0) {
      return { checked: 0, total: 0, percentage: 0 }
    }
    const total = trip.items.length
    const checked = trip.items.filter(item => item.checkedInAt).length
    return {
      checked,
      total,
      percentage: Math.round((checked / total) * 100)
    }
  }, [trip.items])

  const todayProgress = useMemo(() => {
    if (!trip.items || !todayDayId) {
      return { checked: 0, total: 0, percentage: 0 }
    }
    const todayItems = trip.items.filter(item => item.dayId === todayDayId)
    const total = todayItems.length
    const checked = todayItems.filter(item => item.checkedInAt).length
    return {
      checked,
      total,
      percentage: total > 0 ? Math.round((checked / total) * 100) : 0
    }
  }, [trip.items, todayDayId])

  if (!traveling) {
    return null
  }

  return (
    <div className="travel-mode-banner">
      <div className="travel-mode-content">
        <span className="travel-mode-badge">旅行中</span>
        <div className="travel-mode-progress">
          <span className="travel-mode-progress-text">
            全体: {progress.checked}/{progress.total} ({progress.percentage}%)
          </span>
          {todayDayId && todayProgress.total > 0 && (
            <span className="travel-mode-progress-text">
              今日: {todayProgress.checked}/{todayProgress.total}
            </span>
          )}
        </div>
      </div>
      {todayDayId && onJumpToToday && (
        <button
          className="travel-mode-jump-btn"
          onClick={onJumpToToday}
        >
          今日の日程へ
        </button>
      )}
    </div>
  )
}
