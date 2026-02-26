import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { Trip } from '../types'
import { formatDateRange } from '../utils'
import { useAuth } from '../hooks/useAuth'

export function TripListPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTripTitle, setNewTripTitle] = useState('')
  const [newTripStartDate, setNewTripStartDate] = useState('')
  const [newTripEndDate, setNewTripEndDate] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!authLoading) {
      fetchTrips()
    }
  }, [authLoading])

  async function fetchTrips() {
    try {
      const res = await fetch('/api/trips')
      const data = (await res.json()) as { trips: Trip[] }
      setTrips(data.trips || [])
    } catch (err) {
      console.error('Failed to fetch trips:', err)
    } finally {
      setLoading(false)
    }
  }

  async function createTrip(e: React.FormEvent) {
    e.preventDefault()
    if (!newTripTitle.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTripTitle.trim(),
          startDate: newTripStartDate || undefined,
          endDate: newTripEndDate || undefined,
        }),
      })
      const data = (await res.json()) as { trip: Trip }
      if (data.trip) {
        navigate(`/trips/${data.trip.id}/edit`)
      }
    } catch (err) {
      console.error('Failed to create trip:', err)
    } finally {
      setCreating(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">読み込み中...</p>
      </div>
    )
  }

  // Show login prompt if not logged in and no trips
  if (!user && trips.length === 0) {
    return (
      <div className="hero">
        <h1 className="hero-title">
          作るだけで綺麗。<br />
          旅の思い出を、<br />
          そのまま人に見せられる<br />
          ページに。
        </h1>
        <p className="hero-subtitle">旅程を作って、共有しましょう</p>
        <div className="hero-actions">
          <Link to="/login" className="btn-filled">
            ログインして始める
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="trip-list-section">
      <div className="section-header">
        <span className="section-title">{user ? 'マイ旅程' : 'trips'}</span>
        <button
          className="btn-outline"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? 'キャンセル' : 'あたらしい旅程'}
        </button>
      </div>

      {showCreateForm && (
        <form className="create-form" onSubmit={createTrip}>
          <input
            type="text"
            placeholder="旅程のタイトル"
            value={newTripTitle}
            onChange={(e) => setNewTripTitle(e.target.value)}
            className="input"
            autoFocus
          />
          <div className="date-inputs">
            <input
              type="date"
              value={newTripStartDate}
              onChange={(e) => setNewTripStartDate(e.target.value)}
              className="input"
            />
            <span className="date-separator">〜</span>
            <input
              type="date"
              value={newTripEndDate}
              onChange={(e) => setNewTripEndDate(e.target.value)}
              className="input"
            />
          </div>
          <button
            type="submit"
            className="btn-filled"
            disabled={creating || !newTripTitle.trim()}
          >
            {creating ? '作成中...' : '作成する'}
          </button>
        </form>
      )}

      {trips.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">—</div>
          <p className="empty-state-text">
            まだ旅程がありません。<br />
            あたらしい旅程をつくりましょう。
          </p>
        </div>
      ) : (
        trips.map((trip) => (
          <div
            key={trip.id}
            className="trip-card"
            onClick={() => navigate(`/trips/${trip.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <div className="trip-card-title">{trip.title}</div>
            {trip.startDate && trip.endDate && (
              <div className="trip-card-date">
                {formatDateRange(trip.startDate, trip.endDate)}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
