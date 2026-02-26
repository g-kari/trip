import { useState, useEffect, useLayoutEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Trip, Item } from '../types'
import { formatDateRange, formatCost, formatDayLabel } from '../utils'

export function TripViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)

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
      const res = await fetch(`/api/trips/${tripId}`)
      if (!res.ok) {
        setError('旅程が見つかりませんでした')
        setLoading(false)
        return
      }
      const data = (await res.json()) as { trip: Trip; isOwner: boolean }
      setTrip(data.trip)
      setIsOwner(data.isOwner)

      // Fetch share token
      const shareRes = await fetch(`/api/trips/${tripId}/share`)
      const shareData = (await shareRes.json()) as { token: string | null }
      setShareToken(shareData.token)
    } catch (err) {
      console.error('Failed to fetch trip:', err)
      setError('旅程の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function createShareLink() {
    if (!trip) return

    try {
      const res = await fetch(`/api/trips/${trip.id}/share`, { method: 'POST' })
      const data = (await res.json()) as { token: string }
      setShareToken(data.token)
      setShowShareModal(true)
    } catch (err) {
      console.error('Failed to create share link:', err)
    }
  }

  async function deleteShareLink() {
    if (!trip) return
    if (!confirm('共有リンクを削除しますか？')) return

    try {
      await fetch(`/api/trips/${trip.id}/share`, { method: 'DELETE' })
      setShareToken(null)
      setShowShareModal(false)
    } catch (err) {
      console.error('Failed to delete share link:', err)
    }
  }

  function copyShareLink() {
    if (!shareToken) return
    const url = `${window.location.origin}/s/${shareToken}`
    navigator.clipboard.writeText(url)
    alert('リンクをコピーしました')
  }

  function printTrip() {
    window.print()
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
      <div className="empty-state">
        <p className="empty-state-text">読み込み中...</p>
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">{error || '旅程が見つかりませんでした'}</p>
        <button className="btn-text" onClick={() => navigate('/')}>
          ← 旅程一覧に戻る
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
        <div className="hero-actions-row no-print">
          {isOwner && (
            <>
              <Link to={`/trips/${trip.id}/edit`} className="btn-text">編集</Link>
              <button className="btn-text" onClick={createShareLink}>共有</button>
            </>
          )}
          <button className="btn-text" onClick={printTrip}>印刷</button>
        </div>
      </div>

      {(!trip.days || trip.days.length === 0) ? (
        <div className="empty-state">
          <p className="empty-state-text">
            日程がまだありません。
          </p>
          {isOwner && (
            <Link to={`/trips/${trip.id}/edit`} className="btn-outline no-print" style={{ marginTop: 'var(--space-4)' }}>
              編集して日程を追加
            </Link>
          )}
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
                    <span className="timeline-time">—</span>
                    <div className="timeline-content">
                      <span className="timeline-title" style={{ color: 'var(--color-text-faint)' }}>
                        予定がありません
                      </span>
                    </div>
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="timeline-item">
                      <span className="timeline-time">{item.timeStart || '—'}</span>
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
                        {item.note && (
                          <p className="timeline-note">{item.note}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          })
      )}

      {getTotalCost() > 0 && (
        <div className="total-cost">
          <span className="total-cost-label">合計費用</span>
          <span className="total-cost-value">{formatCost(getTotalCost())}</span>
        </div>
      )}

      <button
        className="btn-text back-btn no-print"
        onClick={() => navigate('/')}
      >
        ← 旅程一覧に戻る
      </button>

      {/* Share modal */}
      {showShareModal && shareToken && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">共有リンク</h2>
            <div className="share-url-box">
              <code className="share-url">{window.location.origin}/s/{shareToken}</code>
            </div>
            <div className="modal-actions">
              <button className="btn-text btn-danger" onClick={deleteShareLink}>
                リンクを削除
              </button>
              <button className="btn-filled" onClick={copyShareLink}>
                コピー
              </button>
            </div>
            <button className="btn-text modal-close" onClick={() => setShowShareModal(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  )
}
