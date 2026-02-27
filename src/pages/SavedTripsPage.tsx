import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { formatDateRange } from '../utils'
import { SkeletonTripCard } from '../components/Skeleton'
import { HeartIcon, HeartFilledIcon, BookmarkFilledIcon } from '../components/Icons'
import type { TripTheme } from '../types'

type SavedTrip = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme | null
  coverImageUrl: string | null
  likeCount: number
  dayCount: number
  isLiked: boolean
  isSaved: boolean
  savedAt: string
}

export function SavedTripsPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showError, showSuccess } = useToast()
  const [trips, setTrips] = useState<SavedTrip[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSavedTrips = useCallback(async () => {
    try {
      const res = await fetch('/api/gallery/saved')
      if (!res.ok) {
        if (res.status === 401) {
          navigate('/login')
          return
        }
        showError('保存した旅程の読み込みに失敗しました')
        return
      }
      const data = (await res.json()) as { trips: SavedTrip[] }
      setTrips(data.trips || [])
    } catch (err) {
      console.error('Failed to fetch saved trips:', err)
      showError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [navigate, showError])

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        navigate('/login')
        return
      }
      fetchSavedTrips()
    }
  }, [authLoading, user, navigate, fetchSavedTrips])

  async function toggleLike(tripId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    try {
      const res = await fetch(`/api/gallery/${tripId}/like`, { method: 'POST' })
      if (!res.ok) {
        showError('いいねに失敗しました')
        return
      }
      const data = (await res.json()) as { liked: boolean; likeCount: number }

      setTrips(prev => prev.map(trip =>
        trip.id === tripId
          ? { ...trip, isLiked: data.liked, likeCount: data.likeCount }
          : trip
      ))
    } catch (err) {
      console.error('Failed to toggle like:', err)
      showError('いいねに失敗しました')
    }
  }

  async function toggleSave(tripId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    try {
      const res = await fetch(`/api/gallery/${tripId}/save`, { method: 'POST' })
      if (!res.ok) {
        showError('保存の解除に失敗しました')
        return
      }
      const data = (await res.json()) as { saved: boolean }

      if (!data.saved) {
        // Remove from list if unsaved
        setTrips(prev => prev.filter(trip => trip.id !== tripId))
        showSuccess('保存を解除しました')
      }
    } catch (err) {
      console.error('Failed to toggle save:', err)
      showError('保存の解除に失敗しました')
    }
  }

  function getDaysCount(startDate: string | null, endDate: string | null): number {
    if (!startDate || !endDate) return 0
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
  }

  if (loading || authLoading) {
    return (
      <div className="gallery-page">
        <div className="gallery-header">
          <h1 className="gallery-title">保存した旅程</h1>
          <p className="gallery-subtitle">あとで見返したい旅程</p>
        </div>
        <div className="gallery-grid">
          {[1, 2, 3].map((i) => (
            <SkeletonTripCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <h1 className="gallery-title">保存した旅程</h1>
        <p className="gallery-subtitle">あとで見返したい旅程</p>
      </div>

      {trips.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">-</div>
          <p className="empty-state-text">
            保存した旅程がありません。<br />
            ギャラリーで気になる旅程を保存してみましょう。
          </p>
          <Link to="/gallery" className="btn-outline" style={{ marginTop: 'var(--space-4)' }}>
            ギャラリーを見る
          </Link>
        </div>
      ) : (
        <div className="gallery-grid">
          {trips.map((trip) => (
            <Link
              key={trip.id}
              to={`/gallery/${trip.id}`}
              className="gallery-card"
            >
              {trip.coverImageUrl ? (
                <div
                  className="gallery-card-image"
                  style={{ backgroundImage: `url(${trip.coverImageUrl})` }}
                />
              ) : (
                <div className="gallery-card-image gallery-card-image-placeholder">
                  <span className="gallery-card-image-icon">旅</span>
                </div>
              )}
              <div className="gallery-card-content">
                <h3 className="gallery-card-title">{trip.title}</h3>
                <div className="gallery-card-meta">
                  {trip.startDate && trip.endDate && (
                    <>
                      <span className="gallery-card-days">
                        {trip.dayCount || getDaysCount(trip.startDate, trip.endDate)}日間
                      </span>
                      <span className="gallery-card-date">
                        {formatDateRange(trip.startDate, trip.endDate)}
                      </span>
                    </>
                  )}
                </div>
                <div className="gallery-card-actions">
                  <button
                    type="button"
                    className={`gallery-action-btn like-btn ${trip.isLiked ? 'active' : ''}`}
                    onClick={(e) => toggleLike(trip.id, e)}
                    title={trip.isLiked ? 'いいねを取り消す' : 'いいね'}
                  >
                    {trip.isLiked ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />}
                    <span className="action-count">{trip.likeCount}</span>
                  </button>
                  <button
                    type="button"
                    className="gallery-action-btn save-btn active"
                    onClick={(e) => toggleSave(trip.id, e)}
                    title="保存を解除"
                  >
                    <BookmarkFilledIcon size={16} />
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <button
        className="btn-text back-btn"
        onClick={() => navigate('/gallery')}
      >
        ギャラリーに戻る
      </button>
    </div>
  )
}
