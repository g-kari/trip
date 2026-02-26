import { useEffect, useState, useLayoutEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { TripTheme } from '../types'

type Trip = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme
  coverImageUrl: string | null
}

type DayWithItems = {
  id: string
  date: string
  items: Array<{
    id: string
    title: string
    area: string | null
    timeStart: string | null
    timeEnd: string | null
    cost: number | null
  }>
}

export function EmbedPage() {
  const { id } = useParams<{ id: string }>()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<DayWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Apply theme to document
  useLayoutEffect(() => {
    if (trip?.theme && trip.theme !== 'quiet') {
      document.documentElement.setAttribute('data-theme', trip.theme)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    return () => {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [trip?.theme])

  useEffect(() => {
    async function fetchTrip() {
      try {
        const res = await fetch(`/api/trips/${id}`)
        if (!res.ok) throw new Error('Trip not found')
        const data = await res.json() as {
          trip: Trip & {
            days?: Array<{ id: string; date: string; sort: number }>
            items?: Array<{
              id: string
              dayId: string
              title: string
              area: string | null
              timeStart: string | null
              timeEnd: string | null
              cost: number | null
              sort: number
            }>
          }
        }
        setTrip({
          id: data.trip.id,
          title: data.trip.title,
          startDate: data.trip.startDate,
          endDate: data.trip.endDate,
          theme: data.trip.theme || 'quiet',
          coverImageUrl: data.trip.coverImageUrl,
        })

        // Group items by day
        const daysWithItems: DayWithItems[] = (data.trip.days || [])
          .sort((a, b) => a.sort - b.sort)
          .map(day => ({
            id: day.id,
            date: day.date,
            items: (data.trip.items || [])
              .filter(item => item.dayId === day.id)
              .sort((a, b) => a.sort - b.sort)
              .map(item => ({
                id: item.id,
                title: item.title,
                area: item.area,
                timeStart: item.timeStart,
                timeEnd: item.timeEnd,
                cost: item.cost,
              })),
          }))
        setDays(daysWithItems)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    if (id) fetchTrip()
  }, [id])

  if (loading) return <div className="embed-loading">読み込み中...</div>
  if (error || !trip) return <div className="embed-error">旅程が見つかりません</div>

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <div className={`embed-page theme-${trip.theme}`}>
      {trip.coverImageUrl && (
        <div className="embed-cover">
          <img src={trip.coverImageUrl} alt="" />
        </div>
      )}

      <div className="embed-header">
        <h1 className="embed-title">{trip.title}</h1>
        {trip.startDate && trip.endDate && (
          <p className="embed-dates">
            {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
          </p>
        )}
      </div>

      <div className="embed-content">
        {days.map(day => (
          <div key={day.id} className="embed-day">
            <h2 className="embed-day-date">{formatDate(day.date)}</h2>
            <ul className="embed-items">
              {day.items.map(item => (
                <li key={item.id} className="embed-item">
                  <span className="embed-item-time">
                    {item.timeStart || ''}
                  </span>
                  <span className="embed-item-title">{item.title}</span>
                  {item.area && <span className="embed-item-area">{item.area}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="embed-footer">
        <Link to={`/trips/${id}`} target="_blank" className="embed-link">
          旅程で見る
        </Link>
        <span className="embed-branding">旅程</span>
      </div>
    </div>
  )
}
