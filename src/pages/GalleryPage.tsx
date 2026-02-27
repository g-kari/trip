import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { formatDateRange } from '../utils'
import { SkeletonTripCard } from '../components/Skeleton'
import { HeartIcon, HeartFilledIcon, BookmarkIcon, BookmarkFilledIcon } from '../components/Icons'
import type { TripTheme } from '../types'

type GalleryTrip = {
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
  createdAt: string
}

type SortOption = 'likes' | 'recent'
type DaysFilter = '' | '1-2' | '3-4' | '5+'

export function GalleryPage() {
  const { user, loading: authLoading } = useAuth()
  const { showError, showSuccess } = useToast()
  const [trips, setTrips] = useState<GalleryTrip[]>([])
  const [loading, setLoading] = useState(true)

  // Filter state
  const [region, setRegion] = useState('')
  const [daysFilter, setDaysFilter] = useState<DaysFilter>('')
  const [sortOption, setSortOption] = useState<SortOption>('likes')
  const [showFilters, setShowFilters] = useState(false)

  // Build query params
  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams()
    if (region.trim()) params.set('region', region.trim())
    if (sortOption !== 'likes') params.set('sort', sortOption)

    if (daysFilter === '1-2') {
      params.set('minDays', '1')
      params.set('maxDays', '2')
    } else if (daysFilter === '3-4') {
      params.set('minDays', '3')
      params.set('maxDays', '4')
    } else if (daysFilter === '5+') {
      params.set('minDays', '5')
    }

    return params.toString()
  }, [region, daysFilter, sortOption])

  const fetchTrips = useCallback(async () => {
    setLoading(true)
    try {
      const queryString = buildQueryParams()
      const url = queryString ? `/api/gallery?${queryString}` : '/api/gallery'
      const res = await fetch(url)
      if (!res.ok) {
        showError('ギャラリーの読み込みに失敗しました')
        return
      }
      const data = (await res.json()) as { trips: GalleryTrip[] }
      setTrips(data.trips || [])
    } catch (err) {
      console.error('Failed to fetch gallery:', err)
      showError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [buildQueryParams, showError])

  useEffect(() => {
    if (!authLoading) {
      fetchTrips()
    }
  }, [authLoading, fetchTrips])

  async function toggleLike(tripId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      showError('いいねするにはログインが必要です')
      return
    }

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

    if (!user) {
      showError('保存するにはログインが必要です')
      return
    }

    try {
      const res = await fetch(`/api/gallery/${tripId}/save`, { method: 'POST' })
      if (!res.ok) {
        showError('保存に失敗しました')
        return
      }
      const data = (await res.json()) as { saved: boolean }

      setTrips(prev => prev.map(trip =>
        trip.id === tripId
          ? { ...trip, isSaved: data.saved }
          : trip
      ))

      if (data.saved) {
        showSuccess('保存しました')
      }
    } catch (err) {
      console.error('Failed to toggle save:', err)
      showError('保存に失敗しました')
    }
  }

  function getDaysCount(startDate: string | null, endDate: string | null): number {
    if (!startDate || !endDate) return 0
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
  }

  function handleSearch() {
    fetchTrips()
  }

  function clearFilters() {
    setRegion('')
    setDaysFilter('')
    setSortOption('likes')
  }

  const hasActiveFilters = region.trim() || daysFilter || sortOption !== 'likes'

  if (loading || authLoading) {
    return (
      <div className="gallery-page">
        <div className="gallery-header">
          <h1 className="gallery-title">ギャラリー</h1>
          <p className="gallery-subtitle">みんなの旅程を参考にしよう</p>
        </div>
        <div className="gallery-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonTripCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <h1 className="gallery-title">ギャラリー</h1>
        <p className="gallery-subtitle">みんなの旅程を参考にしよう</p>
      </div>

      {/* Search & Filter */}
      <div className="gallery-search-section">
        <div className="gallery-search-bar">
          <input
            type="text"
            placeholder="地域で検索（例: 京都、沖縄）"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="input gallery-search-input"
          />
          <button
            type="button"
            className="btn-filled gallery-search-btn"
            onClick={handleSearch}
          >
            検索
          </button>
          <button
            type="button"
            className={`btn-text filter-toggle ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? '閉じる' : '絞り込み'}
            {hasActiveFilters && !showFilters && <span className="filter-indicator" />}
          </button>
        </div>

        {showFilters && (
          <div className="gallery-filter-options">
            {/* Days filter */}
            <div className="filter-row">
              <label className="filter-label">日数</label>
              <div className="filter-buttons">
                <button
                  type="button"
                  className={`filter-btn ${daysFilter === '' ? 'active' : ''}`}
                  onClick={() => setDaysFilter('')}
                >
                  すべて
                </button>
                <button
                  type="button"
                  className={`filter-btn ${daysFilter === '1-2' ? 'active' : ''}`}
                  onClick={() => setDaysFilter('1-2')}
                >
                  1-2日
                </button>
                <button
                  type="button"
                  className={`filter-btn ${daysFilter === '3-4' ? 'active' : ''}`}
                  onClick={() => setDaysFilter('3-4')}
                >
                  3-4日
                </button>
                <button
                  type="button"
                  className={`filter-btn ${daysFilter === '5+' ? 'active' : ''}`}
                  onClick={() => setDaysFilter('5+')}
                >
                  5日以上
                </button>
              </div>
            </div>

            {/* Sort order */}
            <div className="filter-row">
              <label className="filter-label">並び順</label>
              <div className="filter-buttons">
                <button
                  type="button"
                  className={`filter-btn ${sortOption === 'likes' ? 'active' : ''}`}
                  onClick={() => setSortOption('likes')}
                >
                  人気順
                </button>
                <button
                  type="button"
                  className={`filter-btn ${sortOption === 'recent' ? 'active' : ''}`}
                  onClick={() => setSortOption('recent')}
                >
                  新着順
                </button>
              </div>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-text clear-filters-btn"
                onClick={clearFilters}
              >
                フィルターをクリア
              </button>
            )}
          </div>
        )}
      </div>

      {/* Trip Grid */}
      {trips.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">—</div>
          <p className="empty-state-text">
            {hasActiveFilters
              ? '検索条件に一致する旅程がありません'
              : '公開されている旅程がまだありません'
            }
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn-text"
              onClick={clearFilters}
            >
              フィルターをクリア
            </button>
          )}
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
                    className={`gallery-action-btn save-btn ${trip.isSaved ? 'active' : ''}`}
                    onClick={(e) => toggleSave(trip.id, e)}
                    title={trip.isSaved ? '保存を取り消す' : '保存'}
                  >
                    {trip.isSaved ? <BookmarkFilledIcon size={16} /> : <BookmarkIcon size={16} />}
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Saved trips link for logged in users */}
      {user && (
        <div className="gallery-saved-section">
          <Link to="/gallery/saved" className="btn-outline">
            保存した旅程を見る
          </Link>
        </div>
      )}
    </div>
  )
}
