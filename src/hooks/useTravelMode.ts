import { useMemo } from 'react'
import type { Trip, Day } from '../types'

// Check if a date is today in JST
function isTodayJST(dateStr: string): boolean {
  const now = new Date()
  // Convert to JST (UTC+9)
  const jstOffset = 9 * 60 * 60 * 1000
  const jstNow = new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60 * 1000)
  const today = jstNow.toISOString().split('T')[0]
  return dateStr === today
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

// Hook to check if trip is in travel mode
export function useTravelMode(trip: Trip | null) {
  return useMemo(() => {
    if (!trip) return { isTraveling: false, todayDayId: null, canCheckIn: false }

    const traveling = isTraveling(trip.startDate, trip.endDate)
    const todayDayId = getTodayDayId(trip.days)

    return {
      isTraveling: traveling,
      todayDayId,
      canCheckIn: traveling // Can only check in during the trip
    }
  }, [trip])
}

// Hook to check if a specific day is today
export function useIsToday(dateStr: string) {
  return useMemo(() => isTodayJST(dateStr), [dateStr])
}

// Format check-in time for display
export function formatCheckinTime(checkedInAt: string | null): string {
  if (!checkedInAt) return ''

  const date = new Date(checkedInAt)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}
