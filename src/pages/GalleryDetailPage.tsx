import { useState, useEffect, useLayoutEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { TripTheme, Day, Item } from '../types'
import { formatDateRange, formatCost, formatDayLabel } from '../utils'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../hooks/useAuth'
import { SkeletonHero, SkeletonDaySection } from '../components/Skeleton'
import { HeartIcon, HeartFilledIcon, BookmarkIcon, BookmarkFilledIcon, CopyIcon } from '../components/Icons'
import { MapEmbed } from '../components/MapEmbed'

type GalleryTripDetail = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme | null
  coverImageUrl: string | null
  likeCount: number
  isLiked: boolean
  isSaved: boolean
  days: Day[]
  items: Item[]
  createdAt: string
}

export function GalleryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError, showSuccess } = useToast()
  const { user } = useAuth()
  const [trip, setTrip] = useState<GalleryTripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingCopy, setCreatingCopy] = useState(false)

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
    if (id) {
      fetchTrip(id)
    }
  }, [id])

  async function fetchTrip(tripId: string) {
    try {
      const res = await fetch(`/api/gallery/${tripId}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('この旅程は公開されていないか、存在しません')
        } else {
          setError('旅程の読み込みに失敗しました')
        }
        setLoading(false)
        return
      }
      const data = (await res.json()) as { trip: GalleryTripDetail }
      setTrip(data.trip)
    } catch (err) {
      console.error('Failed to fetch trip:', err)
      setError('旅程の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function toggleLike() {
    if (!trip || !user) {
      showError('いいねするにはログインが必要です')
      return
    }

    try {
      const res = await fetch(`/api/gallery/${trip.id}/like`, { method: 'POST' })
      if (!res.ok) {
        showError('いいねに失敗しました')
        return
      }
      const data = (await res.json()) as { liked: boolean; likeCount: number }

      setTrip(prev => prev ? {
        ...prev,
        isLiked: data.liked,
        likeCount: data.likeCount,
      } : prev)
    } catch (err) {
      console.error('Failed to toggle like:', err)
      showError('いいねに失敗しました')
    }
  }

  async function toggleSave() {
    if (!trip || !user) {
      showError('保存するにはログインが必要です')
      return
    }

    try {
      const res = await fetch(`/api/gallery/${trip.id}/save`, { method: 'POST' })
      if (!res.ok) {
        showError('保存に失敗しました')
        return
      }
      const data = (await res.json()) as { saved: boolean }

      setTrip(prev => prev ? {
        ...prev,
        isSaved: data.saved,
      } : prev)

      if (data.saved) {
        showSuccess('保存しました')
      }
    } catch (err) {
      console.error('Failed to toggle save:', err)
      showError('保存に失敗しました')
    }
  }

  async function useAsTemplate() {
    if (!trip) return

    if (!user) {
      showError('この機能にはログインが必要です')
      return
    }

    if (!confirm('この旅程を参考にして新しい旅程を作成しますか？')) return

    setCreatingCopy(true)
    try {
      const res = await fetch(`/api/gallery/${trip.id}/use`, { method: 'POST' })
      const data = (await res.json()) as { tripId?: string; error?: string; code?: string }

      if (!res.ok) {
        if (data.code === 'SLOT_LIMIT_REACHED') {
          showError('旅程枠が不足しています。プロフィールページから追加の枠を購入してください。')
          navigate('/profile')
          return
        }
        showError(data.error || 'コピーに失敗しました')
        return
      }

      if (data.tripId) {
        showSuccess('旅程を作成しました')
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to use as template:', err)
      showError('コピーに失敗しました')
    } finally {
      setCreatingCopy(false)
    }
  }

  function getItemsForDay(dayId: string): Item[] {
    return (trip?.items || [])
      .filter((item) => item.dayId === dayId)
      .sort((a, b) => {
        if (a.timeStart && b.timeStart) return a.timeStart.localeCompare(b.timeStart)
        return a.sort - b.sort
      })
  }

  function getTotalCost(): number {
    return (trip?.items || []).reduce((sum, item) => sum + (item.cost || 0), 0)
  }

  if (loading) {
    return (
      <>
        <SkeletonHero />
        <SkeletonDaySection itemCount={3} />
        <SkeletonDaySection itemCount={2} />
      </>
    )
  }

  if (error || !trip) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">{error || '旅程が見つかりませんでした'}</p>
        <button className="btn-text" onClick={() => navigate('/gallery')}>
          ギャラリーに戻る
        </button>
      </div>
    )
  }

  return (
    <>
      <div
        className={`hero print-hero ${trip.coverImageUrl ? 'hero-with-cover' : ''}`}
        style={{
          padding: 'var(--space-7) 0 var(--space-5)',
          ...(trip.coverImageUrl ? { backgroundImage: `url(${trip.coverImageUrl})` } : {}),
        }}
      >
        <h1 className="hero-title">{trip.title}</h1>
        {trip.startDate && trip.endDate && (
          <p className="hero-subtitle">
            {formatDateRange(trip.startDate, trip.endDate)}
          </p>
        )}

        {/* Gallery actions */}
        <div className="gallery-detail-actions no-print">
          <button
            className={`gallery-detail-action-btn ${trip.isLiked ? 'active' : ''}`}
            onClick={toggleLike}
            title={trip.isLiked ? 'いいねを取り消す' : 'いいね'}
          >
            {trip.isLiked ? <HeartFilledIcon size={20} /> : <HeartIcon size={20} />}
            <span className="action-count">{trip.likeCount}</span>
          </button>
          <button
            className={`gallery-detail-action-btn ${trip.isSaved ? 'active' : ''}`}
            onClick={toggleSave}
            title={trip.isSaved ? '保存を取り消す' : '保存'}
          >
            {trip.isSaved ? <BookmarkFilledIcon size={20} /> : <BookmarkIcon size={20} />}
            <span>{trip.isSaved ? '保存済み' : '保存'}</span>
          </button>
          <button
            className="gallery-detail-action-btn primary"
            onClick={useAsTemplate}
            disabled={creatingCopy}
            title="この旅程を参考にする"
          >
            <CopyIcon size={20} />
            <span>{creatingCopy ? '作成中...' : 'この旅程を参考にする'}</span>
          </button>
        </div>
      </div>

      {/* Map section */}
      <MapEmbed items={trip.items || []} />

      {(!trip.days || trip.days.length === 0) ? (
        <div className="empty-state">
          <p className="empty-state-text">
            日程がありません。
          </p>
        </div>
      ) : (
        trip.days
          .sort((a, b) => a.sort - b.sort)
          .map((day, index) => {
            const { label, dateStr } = formatDayLabel(day.date, index)
            const items = getItemsForDay(day.id)
            return (
              <div key={day.id} className="day-section">
                <div className="day-header">
                  <span className="day-label">{label}</span>
                  <span className="day-date">{dateStr}</span>
                </div>
                {items.length === 0 ? (
                  <div className="timeline-item">
                    <span className="timeline-time">-</span>
                    <div className="timeline-content">
                      <span className="timeline-title" style={{ color: 'var(--color-text-faint)' }}>
                        予定がありません
                      </span>
                    </div>
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="timeline-item">
                      <span className="timeline-time">{item.timeStart || '-'}</span>
                      <div className="timeline-content">
                        <span className="timeline-title">{item.title}</span>
                        <div className="timeline-meta">
                          {item.area && <span>{item.area}</span>}
                          {item.cost != null && item.cost > 0 && (
                            <span>{formatCost(item.cost)}</span>
                          )}
                          {item.mapUrl && (
                            <a
                              href={item.mapUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="map-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              地図を見る
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          })
      )}

      {/* Total cost */}
      {getTotalCost() > 0 && (
        <div className="total-cost">
          <span className="total-cost-label">合計費用</span>
          <span className="total-cost-value">{formatCost(getTotalCost())}</span>
        </div>
      )}

      {/* Login prompt for non-logged-in users */}
      {!user && (
        <div className="gallery-login-prompt">
          <p>いいね、保存、旅程の作成にはログインが必要です</p>
          <Link to="/login" className="btn-filled">
            ログインする
          </Link>
        </div>
      )}

      <button
        className="btn-text back-btn no-print"
        onClick={() => navigate('/gallery')}
      >
        ギャラリーに戻る
      </button>
    </>
  )
}
