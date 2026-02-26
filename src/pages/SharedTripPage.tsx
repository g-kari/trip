import { useState, useEffect, useLayoutEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { Trip, Item } from '../types'
import { formatDateRange, formatCost, formatDayDate } from '../utils'

export function SharedTripPage() {
  const { token } = useParams<{ token: string }>()
  const [trip, setTrip] = useState<Trip | null>(null)
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
        const res = await fetch(`/api/shared/${token}`)
        if (!res.ok) {
          if (res.status === 404) {
            setError('このリンクは無効です')
          } else if (res.status === 410) {
            setError('このリンクは期限切れです')
          } else {
            setError('この旅程は見つかりませんでした')
          }
          return
        }
        const data = await res.json() as { trip: Trip }
        setTrip(data.trip)
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }
    fetchTrip()
  }, [token])

  if (loading) {
    return (
      <div className="app">
        <header className="header">
          <span className="header-logo">旅程</span>
        </header>
        <main className="main">
          <div className="hero">
            <div className="skeleton-title" style={{ width: '200px', height: '24px', background: 'var(--color-border-light)', borderRadius: '4px' }} />
            <div className="skeleton-date" style={{ width: '140px', height: '16px', background: 'var(--color-border-light)', borderRadius: '4px', marginTop: '8px' }} />
          </div>
        </main>
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div className="app">
        <header className="header">
          <span className="header-logo">旅程</span>
        </header>
        <main className="main">
          <div className="empty-state">
            <p className="empty-state-text">{error || 'この旅程は見つかりませんでした'}</p>
          </div>
        </main>
      </div>
    )
  }

  // Group items by day
  const days = trip.days || []
  const items = trip.items || []
  const itemsByDay = new Map<string, Item[]>()
  for (const item of items) {
    const dayItems = itemsByDay.get(item.dayId) || []
    dayItems.push(item)
    itemsByDay.set(item.dayId, dayItems)
  }

  // Sort items by time and sort order
  for (const dayItems of itemsByDay.values()) {
    dayItems.sort((a, b) => {
      if (a.timeStart && b.timeStart) {
        return a.timeStart.localeCompare(b.timeStart)
      }
      return a.sort - b.sort
    })
  }

  // Calculate total cost
  const totalCost = items.reduce((sum, item) => sum + (item.cost || 0), 0)

  return (
    <div className="app">
      <header className="header">
        <span className="header-logo">旅程</span>
      </header>

      <main className="main">
        <section
          className={`hero ${trip.coverImageUrl ? 'hero-with-cover' : ''}`}
          style={trip.coverImageUrl ? { backgroundImage: `url(${trip.coverImageUrl})` } : undefined}
        >
          <h1 className="hero-title">{trip.title}</h1>
          {(trip.startDate || trip.endDate) && (
            <p className="hero-subtitle">{formatDateRange(trip.startDate, trip.endDate)}</p>
          )}
        </section>

        {days.map((day, index) => {
          const dayItems = itemsByDay.get(day.id) || []
          return (
            <section key={day.id} className="day-section">
              <div className="day-header">
                <span className="day-label">Day {index + 1}</span>
                <span className="day-date">{formatDayDate(day.date)}</span>
              </div>

              {dayItems.length === 0 ? (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-faint)' }}>
                  まだ予定がありません
                </p>
              ) : (
                dayItems.map((item) => (
                  <div key={item.id} className="timeline-item">
                    <span className="timeline-time">
                      {item.timeStart || ''}
                    </span>
                    <div className="timeline-content">
                      <span className="timeline-title">{item.title}</span>
                      <div className="timeline-meta">
                        {item.area && <span>{item.area}</span>}
                        {item.cost !== null && item.cost > 0 && (
                          <span>{formatCost(item.cost)}</span>
                        )}
                        {item.mapUrl && (
                          <a
                            href={item.mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="map-link"
                          >
                            地図
                          </a>
                        )}
                      </div>
                      {item.note && (
                        <p className="timeline-note">{item.note}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </section>
          )
        })}

        {totalCost > 0 && (
          <div className="total-cost">
            <span className="total-cost-label">合計</span>
            <span className="total-cost-value">{formatCost(totalCost)}</span>
          </div>
        )}
      </main>

      <footer className="footer">
        <Link to="/" className="footer-text" style={{ textDecoration: 'none' }}>
          旅程で作成
        </Link>
      </footer>
    </div>
  )
}
