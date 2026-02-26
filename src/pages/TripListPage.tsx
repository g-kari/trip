import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { Trip } from '../types'
import { formatDateRange } from '../utils'
import { useAuth } from '../hooks/useAuth'

type TripStyle = 'relaxed' | 'active' | 'gourmet' | 'sightseeing'

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

  // AI generation state
  const [showAiForm, setShowAiForm] = useState(false)
  const [aiDestination, setAiDestination] = useState('')
  const [aiStartDate, setAiStartDate] = useState('')
  const [aiEndDate, setAiEndDate] = useState('')
  const [aiStyle, setAiStyle] = useState<TripStyle>('sightseeing')
  const [aiBudget, setAiBudget] = useState('')
  const [aiNotes, setAiNotes] = useState('')
  const [generating, setGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiRemaining, setAiRemaining] = useState<number | null>(null)
  const [aiLimitReached, setAiLimitReached] = useState(false)

  useEffect(() => {
    if (!authLoading) {
      fetchTrips()
      if (user) {
        fetchAiUsage()
      }
    }
  }, [authLoading, user])

  async function fetchAiUsage() {
    try {
      const res = await fetch('/api/ai/usage')
      if (res.ok) {
        const data = (await res.json()) as { remaining: number; limit: number }
        setAiRemaining(data.remaining)
        setAiLimitReached(data.remaining <= 0)
      }
    } catch (err) {
      console.error('Failed to fetch AI usage:', err)
    }
  }

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

  async function generateTrip(e: React.FormEvent) {
    e.preventDefault()
    if (!aiDestination.trim() || !aiStartDate || !aiEndDate) return

    setGenerating(true)
    setAiError(null)
    try {
      const res = await fetch('/api/trips/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: aiDestination.trim(),
          startDate: aiStartDate,
          endDate: aiEndDate,
          style: aiStyle,
          budget: aiBudget ? parseInt(aiBudget, 10) : undefined,
          notes: aiNotes || undefined,
        }),
      })
      const data = (await res.json()) as { trip?: Trip; tripId?: string; error?: string; remaining?: number; limitReached?: boolean }
      if (!res.ok) {
        setAiError(data.error || 'エラーが発生しました')
        if (data.limitReached) {
          setAiLimitReached(true)
          setAiRemaining(0)
        }
        return
      }
      if (data.remaining !== undefined) {
        setAiRemaining(data.remaining)
        setAiLimitReached(data.remaining <= 0)
      }
      if (data.tripId) {
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to generate trip:', err)
      setAiError('旅程の生成に失敗しました')
    } finally {
      setGenerating(false)
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
        <div className="section-actions">
          <button
            className="btn-outline"
            onClick={() => {
              setShowAiForm(!showAiForm)
              setShowCreateForm(false)
            }}
          >
            {showAiForm ? 'キャンセル' : 'AIで作成'}
          </button>
          <button
            className="btn-outline"
            onClick={() => {
              setShowCreateForm(!showCreateForm)
              setShowAiForm(false)
            }}
          >
            {showCreateForm ? 'キャンセル' : '手動で作成'}
          </button>
        </div>
      </div>

      {showAiForm && (
        <form className="create-form ai-form" onSubmit={generateTrip}>
          <div className="ai-form-header">
            <span className="ai-form-icon">✨</span>
            <span className="ai-form-title">AIで旅程を自動生成</span>
          </div>
          {!user ? (
            <div className="ai-login-prompt">
              <p>AI生成にはログインが必要です</p>
              <Link to="/login" className="btn-filled">
                ログインする
              </Link>
            </div>
          ) : aiLimitReached ? (
            <div className="ai-limit-reached">
              <p>本日の利用上限に達しました</p>
              <p className="ai-limit-hint">明日また利用できます</p>
            </div>
          ) : (
            <>
              {aiRemaining !== null && (
                <p className="ai-remaining">本日の残り: {aiRemaining}回</p>
              )}
              <input
                type="text"
                placeholder="目的地（例: 京都、沖縄、パリ）"
                value={aiDestination}
                onChange={(e) => setAiDestination(e.target.value)}
                className="input"
                autoFocus
              />
          <div className="date-inputs">
            <input
              type="date"
              value={aiStartDate}
              onChange={(e) => setAiStartDate(e.target.value)}
              className="input"
            />
            <span className="date-separator">〜</span>
            <input
              type="date"
              value={aiEndDate}
              onChange={(e) => setAiEndDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="style-selector">
            <label className="style-label">旅のスタイル</label>
            <div className="style-options">
              <button
                type="button"
                className={`style-btn ${aiStyle === 'sightseeing' ? 'active' : ''}`}
                onClick={() => setAiStyle('sightseeing')}
              >
                観光重視
              </button>
              <button
                type="button"
                className={`style-btn ${aiStyle === 'relaxed' ? 'active' : ''}`}
                onClick={() => setAiStyle('relaxed')}
              >
                のんびり
              </button>
              <button
                type="button"
                className={`style-btn ${aiStyle === 'gourmet' ? 'active' : ''}`}
                onClick={() => setAiStyle('gourmet')}
              >
                グルメ
              </button>
              <button
                type="button"
                className={`style-btn ${aiStyle === 'active' ? 'active' : ''}`}
                onClick={() => setAiStyle('active')}
              >
                アクティブ
              </button>
            </div>
          </div>
          <input
            type="number"
            placeholder="予算（円、任意）"
            value={aiBudget}
            onChange={(e) => setAiBudget(e.target.value)}
            className="input"
          />
          <textarea
            placeholder="その他の要望（任意）"
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            className="input textarea"
            rows={2}
          />
          {aiError && (
            <p className="error-text">{aiError}</p>
          )}
          <button
            type="submit"
            className="btn-filled"
            disabled={generating || !aiDestination.trim() || !aiStartDate || !aiEndDate}
          >
            {generating ? '生成中...' : 'AIで生成する'}
          </button>
          {generating && (
            <p className="generating-hint">AIが旅程を考えています...</p>
          )}
            </>
          )}
        </form>
      )}

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
