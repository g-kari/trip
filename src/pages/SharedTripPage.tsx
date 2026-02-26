import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import type { Trip, Item } from '../types'
import { formatDateRange, formatCost, formatDayDate } from '../utils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { SkeletonHero, SkeletonDaySection } from '../components/Skeleton'

export function SharedTripPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { showSuccess, showError } = useToast()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [tripOwnerId, setTripOwnerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadingItemPhoto, setUploadingItemPhoto] = useState<string | null>(null)
  const [uploadingDayPhoto, setUploadingDayPhoto] = useState<string | null>(null)
  const [uploadingDayPhotoCount, setUploadingDayPhotoCount] = useState<number>(0)
  const [deletingItemPhoto, setDeletingItemPhoto] = useState<string | null>(null)
  const [deletingDayPhoto, setDeletingDayPhoto] = useState<string | null>(null)
  const itemPhotoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

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

  async function refreshTrip() {
    try {
      const res = await fetch(`/api/shared/${token}`)
      if (res.ok) {
        const data = await res.json() as { trip: Trip; tripOwnerId?: string }
        setTrip(data.trip)
        if (data.tripOwnerId) {
          setTripOwnerId(data.tripOwnerId)
        }
      }
    } catch {
      // ignore
    }
  }

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
        const data = await res.json() as { trip: Trip; tripOwnerId?: string }
        setTrip(data.trip)
        if (data.tripOwnerId) {
          setTripOwnerId(data.tripOwnerId)
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }
    fetchTrip()
  }, [token])

  // Upload photo for item
  async function uploadItemPhoto(itemId: string, file: File) {
    if (!trip || !user) return
    if (!file.type.startsWith('image/')) {
      showError('画像ファイルを選択してください')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showError('ファイルサイズは5MB以下にしてください')
      return
    }

    setUploadingItemPhoto(itemId)
    try {
      const res = await fetch(`/api/trips/${trip.id}/items/${itemId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!res.ok) {
        if (res.status === 401) {
          showError('ログインが必要です')
          return
        }
        throw new Error('Upload failed')
      }
      showSuccess('写真をアップロードしました')
      await refreshTrip()
    } catch (err) {
      console.error('Failed to upload photo:', err)
      showError('写真のアップロードに失敗しました')
    } finally {
      setUploadingItemPhoto(null)
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
        await refreshTrip()
      }
    } catch (err) {
      console.error('Failed to upload photos:', err)
      showError('写真のアップロードに失敗しました')
    } finally {
      setUploadingDayPhoto(null)
      setUploadingDayPhotoCount(0)
    }
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
      await refreshTrip()
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
      await refreshTrip()
    } catch (err) {
      console.error('Failed to delete photo:', err)
      showError('写真の削除に失敗しました')
    } finally {
      setDeletingDayPhoto(null)
    }
  }

  // Check if user can delete a photo
  function canDeleteItemPhoto(item: Item): boolean {
    if (!user) return false
    // User can delete if they are the uploader or the trip owner
    return item.photoUploadedBy === user.id || tripOwnerId === user.id
  }

  function canDeleteDayPhoto(photo: { uploadedBy: string | null }): boolean {
    if (!user) return false
    // User can delete if they are the uploader or the trip owner
    return photo.uploadedBy === user.id || tripOwnerId === user.id
  }

  if (loading) {
    return (
      <div className="app">
        <header className="header">
          <span className="header-logo">旅程</span>
        </header>
        <main className="main">
          <SkeletonHero />
          <SkeletonDaySection itemCount={3} />
          <SkeletonDaySection itemCount={2} />
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

  async function duplicateTrip() {
    if (!trip) return

    try {
      const res = await fetch(`/api/trips/${trip.id}/duplicate`, { method: 'POST' })
      const data = (await res.json()) as { tripId?: string; error?: string }
      if (!res.ok) {
        if (res.status === 401) {
          alert('複製するにはログインが必要です')
          navigate('/login')
          return
        }
        alert(data.error || '複製に失敗しました')
        return
      }
      if (data.tripId) {
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to duplicate trip:', err)
      alert('複製に失敗しました')
    }
  }

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
          <div className="hero-actions-row no-print">
            <button className="btn-text" onClick={() => window.print()}>印刷</button>
            <button className="btn-text" onClick={() => window.open(`/api/shared/${token}/pdf`, '_blank')}>PDF</button>
            <button className="btn-text" onClick={() => window.open(`/api/shared/${token}/calendar.ics`, '_blank')}>カレンダー</button>
            <button className="btn-text" onClick={duplicateTrip}>
              {user ? '複製' : '複製してログイン'}
            </button>
          </div>
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
                      {/* Photo upload for logged-in users */}
                      {user && !item.photoUrl && (
                        <div className="photo-upload-section no-print">
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            ref={(el) => {
                              if (el) itemPhotoInputRefs.current.set(item.id, el)
                            }}
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) uploadItemPhoto(item.id, file)
                            }}
                          />
                          <button
                            className="btn-text btn-small"
                            onClick={() => itemPhotoInputRefs.current.get(item.id)?.click()}
                            disabled={uploadingItemPhoto === item.id}
                          >
                            {uploadingItemPhoto === item.id ? 'アップロード中...' : '📷 写真を追加'}
                          </button>
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
                        id={`day-photo-${day.id}`}
                        style={{ display: 'none' }}
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
                        onClick={() => document.getElementById(`day-photo-${day.id}`)?.click()}
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
