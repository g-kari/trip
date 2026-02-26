import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Trip, Item, DayPhoto } from '../types'
import { formatDateRange, formatCost, formatDayLabel } from '../utils'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../hooks/useAuth'

export function TripViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError, showSuccess } = useToast()
  const { user } = useAuth()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [deletingItemPhoto, setDeletingItemPhoto] = useState<string | null>(null)
  const [deletingDayPhoto, setDeletingDayPhoto] = useState<string | null>(null)
  const [uploadingDayPhoto, setUploadingDayPhoto] = useState<string | null>(null)
  const [uploadingDayPhotoCount, setUploadingDayPhotoCount] = useState<number>(0)
  const dayPhotoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

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
      if (!res.ok) {
        showError('共有リンクの作成に失敗しました')
        return
      }
      const data = (await res.json()) as { token: string }
      setShareToken(data.token)
      setShowShareModal(true)
    } catch (err) {
      console.error('Failed to create share link:', err)
      showError('共有リンクの作成に失敗しました')
    }
  }

  async function deleteShareLink() {
    if (!trip) return
    if (!confirm('共有リンクを削除しますか？')) return

    try {
      const res = await fetch(`/api/trips/${trip.id}/share`, { method: 'DELETE' })
      if (!res.ok) {
        showError('共有リンクの削除に失敗しました')
        return
      }
      setShareToken(null)
      setShowShareModal(false)
      showSuccess('共有リンクを削除しました')
    } catch (err) {
      console.error('Failed to delete share link:', err)
      showError('共有リンクの削除に失敗しました')
    }
  }

  function copyShareLink() {
    if (!shareToken) return
    const url = `${window.location.origin}/s/${shareToken}`
    navigator.clipboard.writeText(url)
    showSuccess('リンクをコピーしました')
  }

  function printTrip() {
    window.print()
  }

  function downloadPdf() {
    if (!trip) return
    window.open(`/api/trips/${trip.id}/pdf`, '_blank')
  }

  function exportCalendar() {
    if (!trip) return
    window.open(`/api/trips/${trip.id}/calendar.ics`, '_blank')
  }

  async function duplicateTrip() {
    if (!trip) return
    if (!confirm('この旅程を複製しますか？')) return

    try {
      const res = await fetch(`/api/trips/${trip.id}/duplicate`, { method: 'POST' })
      const data = (await res.json()) as { tripId?: string; error?: string }
      if (!res.ok) {
        showError(data.error || '複製に失敗しました')
        return
      }
      if (data.tripId) {
        showSuccess('旅程を複製しました')
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to duplicate trip:', err)
      showError('複製に失敗しました')
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

  // Delete item photo
  async function deleteItemPhoto(itemId: string) {
    if (!trip || !user) return
    if (!confirm('この写真を削除しますか？')) return

    setDeletingItemPhoto(itemId)
    try {
      const res = await fetch(`/api/trips/${trip.id}/items/${itemId}/photo`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        if (res.status === 401) {
          showError('ログインが必要です')
          return
        }
        if (res.status === 403) {
          showError(data.error || '写真を削除する権限がありません')
          return
        }
        throw new Error('Delete failed')
      }
      showSuccess('写真を削除しました')
      if (id) fetchTrip(id)
    } catch (err) {
      console.error('Failed to delete photo:', err)
      showError('写真の削除に失敗しました')
    } finally {
      setDeletingItemPhoto(null)
    }
  }

  // Delete day photo
  async function deleteDayPhoto(dayId: string, photoId: string) {
    if (!trip || !user) return
    if (!confirm('この写真を削除しますか？')) return

    setDeletingDayPhoto(photoId)
    try {
      const res = await fetch(`/api/trips/${trip.id}/days/${dayId}/photos/${photoId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        if (res.status === 401) {
          showError('ログインが必要です')
          return
        }
        if (res.status === 403) {
          showError(data.error || '写真を削除する権限がありません')
          return
        }
        throw new Error('Delete failed')
      }
      showSuccess('写真を削除しました')
      if (id) fetchTrip(id)
    } catch (err) {
      console.error('Failed to delete photo:', err)
      showError('写真の削除に失敗しました')
    } finally {
      setDeletingDayPhoto(null)
    }
  }

  // Upload multiple photos for day's "その他" section
  async function uploadDayPhotos(dayId: string, files: FileList) {
    if (!trip || !user) return

    // Validate all files first
    const validFiles: File[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        showError(`${file.name}: 画像ファイルを選択してください`)
        continue
      }
      if (file.size > 5 * 1024 * 1024) {
        showError(`${file.name}: ファイルサイズは5MB以下にしてください`)
        continue
      }
      validFiles.push(file)
    }

    if (validFiles.length === 0) return

    setUploadingDayPhoto(dayId)
    setUploadingDayPhotoCount(validFiles.length)

    try {
      // Upload all files in parallel
      const uploadPromises = validFiles.map(async (file) => {
        const res = await fetch(`/api/trips/${trip.id}/days/${dayId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error('ログインが必要です')
          }
          throw new Error(`${file.name}のアップロードに失敗しました`)
        }
        return res
      })

      const results = await Promise.allSettled(uploadPromises)
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      if (failed > 0) {
        const errors = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(r => r.reason?.message || 'アップロードに失敗しました')
        showError(errors[0])
      }

      if (succeeded > 0) {
        showSuccess(`${succeeded}枚の写真をアップロードしました`)
        if (id) fetchTrip(id)
      }
    } catch (err) {
      console.error('Failed to upload photos:', err)
      showError('写真のアップロードに失敗しました')
    } finally {
      setUploadingDayPhoto(null)
      setUploadingDayPhotoCount(0)
    }
  }

  // Check if user can delete item photo (owner can always delete, or uploader can delete their own)
  function canDeleteItemPhoto(item: Item): boolean {
    if (!user) return false
    // Trip owner can delete any photo
    if (isOwner) return true
    // Photo uploader can delete their own photo
    return item.photoUploadedBy === user.id
  }

  // Check if user can delete day photo
  function canDeleteDayPhoto(photo: DayPhoto): boolean {
    if (!user) return false
    // Trip owner can delete any photo
    if (isOwner) return true
    // Photo uploader can delete their own photo
    return photo.uploadedBy === user.id
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
          <button className="btn-text" onClick={downloadPdf}>PDF</button>
          <button className="btn-text" onClick={exportCalendar}>カレンダー</button>
          <button className="btn-text" onClick={duplicateTrip}>複製</button>
          <Link to={`/trips/${trip.id}/album`} className="btn-text">アルバム</Link>
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
                        {item.photoUrl && (
                          <div className="item-photo">
                            <img src={item.photoUrl} alt="思い出の写真" className="memory-photo" />
                            {canDeleteItemPhoto(item) && (
                              <button
                                className="item-photo-delete no-print"
                                onClick={() => deleteItemPhoto(item.id)}
                                disabled={deletingItemPhoto === item.id}
                                title="写真を削除"
                              >
                                {deletingItemPhoto === item.id ? '...' : '×'}
                              </button>
                            )}
                            {item.photoUploadedByName && (
                              <span className="photo-uploader">📷 {item.photoUploadedByName}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {/* その他 section */}
                {(day.notes || (day.photos && day.photos.length > 0) || user) && (
                  <div className="day-notes-section">
                    <div className="day-notes-header">
                      <span className="day-notes-label">その他</span>
                    </div>
                    {day.notes && (
                      <p className="day-notes-text">{day.notes}</p>
                    )}
                    {day.photos && day.photos.length > 0 && (
                      <div className="day-photos-grid">
                        {day.photos.map((photo) => (
                          <div key={photo.id} className="day-photo-item">
                            <img src={photo.photoUrl} alt="思い出の写真" className="day-photo" />
                            {canDeleteDayPhoto(photo) && !photo.id.startsWith('legacy-') && (
                              <button
                                className="day-photo-delete no-print"
                                onClick={() => deleteDayPhoto(day.id, photo.id)}
                                disabled={deletingDayPhoto === photo.id}
                                title="写真を削除"
                              >
                                {deletingDayPhoto === photo.id ? '...' : '×'}
                              </button>
                            )}
                            {photo.uploadedByName && (
                              <span className="photo-uploader">📷 {photo.uploadedByName}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Photo upload for logged-in users */}
                    {user && (
                      <div className="photo-upload-section no-print" style={{ marginTop: 'var(--space-2)' }}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          ref={(el) => {
                            if (el) dayPhotoInputRefs.current.set(day.id, el)
                          }}
                          onChange={(e) => {
                            const files = e.target.files
                            if (files && files.length > 0) {
                              uploadDayPhotos(day.id, files)
                              e.target.value = ''
                            }
                          }}
                        />
                        <button
                          className="btn-text btn-small"
                          onClick={() => dayPhotoInputRefs.current.get(day.id)?.click()}
                          disabled={uploadingDayPhoto === day.id}
                        >
                          {uploadingDayPhoto === day.id
                            ? `${uploadingDayPhotoCount}枚アップロード中...`
                            : '📷 写真を追加（複数可）'}
                        </button>
                      </div>
                    )}
                  </div>
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
              <a
                href={`/s/${shareToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="share-url"
              >
                {window.location.origin}/s/{shareToken}
              </a>
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
