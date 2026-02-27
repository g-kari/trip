import type { Item } from '../types'
import { useWeather, getFirstLocationForDay } from '../hooks/useWeather'
import { WeatherIcon } from './WeatherIcon'

/**
 * Shows weather icon for a day, only when the date is within forecast range.
 * Skips rendering entirely for past dates (>7 days ago) or far future (>16 days).
 */
export function DayWeather({ date, items }: { date: string; items: Item[] }) {
  const location = getFirstLocationForDay(items)

  // Skip dates outside forecast window before even calling the hook
  const inRange = isDateInForecastRange(date)
  const { weather, loading } = useWeather(inRange ? location : null, inRange ? date : null)

  if (!location || !inRange) {
    return null
  }

  return <WeatherIcon weather={weather} loading={loading} size="medium" />
}

function isDateInForecastRange(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const target = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  const diff = Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff >= -1 && diff <= 14
}
