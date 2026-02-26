import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Trip, Item } from '../types'
import { formatDayLabel } from '../utils'
import { Skeleton, SkeletonAlbumGrid } from '../components/Skeleton'

interface AlbumPhoto {
  url: string
  title: string
  time?: string | null
  dayLabel: string
  dayDate: string
  type: 'item' | 'day'
  uploadedByName?: string | null
}

export function AlbumPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

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
      const data = (await res.json()) as { trip: Trip }
      setTrip(data.trip)
    } catch (err) {
      console.error('Failed to fetch trip:', err)
      setError('旅程の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // Collect all photos organized by day (memoized)
  const photosByDay = useMemo(() => {
    if (!trip) return []

    const days = trip.days || []
    const items = trip.items || []

    // Create a map of day id to items
    const itemsByDay = new Map<string, Item[]>()
    for (const item of items) {
      const dayItems = itemsByDay.get(item.dayId) || []
      dayItems.push(item)
      itemsByDay.set(item.dayId, dayItems)
    }

    const result: { dayId: string; dayLabel: string; dayDate: string; photos: AlbumPhoto[] }[] = []

    for (let i = 0; i < days.length; i++) {
      const day = days[i]
      const { label, dateStr } = formatDayLabel(day.date, i)
      const photos: AlbumPhoto[] = []

      // Get item photos
      const dayItems = itemsByDay.get(day.id) || []
      dayItems.sort((a, b) => {
        if (a.timeStart && b.timeStart) return a.timeStart.localeCompare(b.timeStart)
        return a.sort - b.sort
      })

      for (const item of dayItems) {
        if (item.photoUrl) {
          photos.push({
            url: item.photoUrl,
            title: item.title,
            time: item.timeStart,
            dayLabel: label,
            dayDate: dateStr,
            type: 'item',
            uploadedByName: item.photoUploadedByName,
          })
        }
      }

      // Get day photos
      if (day.photos && day.photos.length > 0) {
        for (const photo of day.photos) {
          photos.push({
            url: photo.photoUrl,
            title: 'その他',
            time: null,
            dayLabel: label,
            dayDate: dateStr,
            type: 'day',
            uploadedByName: photo.uploadedByName,
          })
        }
      }

      if (photos.length > 0) {
        result.push({
          dayId: day.id,
          dayLabel: label,
          dayDate: dateStr,
          photos,
        })
      }
    }

    return result
  }, [trip])

  // Get flat list of all photos for lightbox navigation (memoized)
  const allPhotos = useMemo(() => {
    return photosByDay.flatMap((d) => d.photos)
  }, [photosByDay])

  function openLightbox(photoIndex: number) {
    setLightboxIndex(photoIndex)
  }

  function closeLightbox() {
    setLightboxIndex(null)
  }

  const nextPhoto = useCallback(() => {
    if (lightboxIndex === null) return
    setLightboxIndex((lightboxIndex + 1) % allPhotos.length)
  }, [lightboxIndex, allPhotos.length])

  const prevPhoto = useCallback(() => {
    if (lightboxIndex === null) return
    setLightboxIndex((lightboxIndex - 1 + allPhotos.length) % allPhotos.length)
  }, [lightboxIndex, allPhotos.length])

  // Handle keyboard navigation and prevent body scroll when lightbox is open
  useEffect(() => {
    if (lightboxIndex === null) return

    // Prevent body scroll
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') nextPhoto()
      if (e.key === 'ArrowLeft') prevPhoto()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [lightboxIndex, nextPhoto, prevPhoto])

  // Touch/swipe handling for lightbox
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return

    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const deltaX = touchEndX - touchStartX.current
    const deltaY = touchEndY - touchStartY.current

    // Only trigger if horizontal swipe is greater than vertical (to avoid scrolling conflicts)
    // and the swipe is at least 50px
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) {
        prevPhoto()
      } else {
        nextPhoto()
      }
    }

    touchStartX.current = null
    touchStartY.current = null
  }

  if (loading) {
    return (
      <div className="album-page">
        <div className="album-header">
          <div>
            <Skeleton variant="title" width="180px" height="22px" />
            <Skeleton variant="text" width="80px" height="14px" style={{ marginTop: '6px' }} />
          </div>
        </div>
        <div className="skeleton-album-section">
          <div className="skeleton-album-section-header">
            <Skeleton variant="text" width="60px" height="14px" />
            <Skeleton variant="text" width="80px" height="12px" />
          </div>
          <SkeletonAlbumGrid count={4} />
        </div>
        <div className="skeleton-album-section">
          <div className="skeleton-album-section-header">
            <Skeleton variant="text" width="60px" height="14px" />
            <Skeleton variant="text" width="80px" height="12px" />
          </div>
          <SkeletonAlbumGrid count={2} />
        </div>
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

  const totalPhotos = allPhotos.length

  // Calculate global photo index for lightbox
  let globalIndex = 0
  const dayStartIndices: Map<string, number> = new Map()
  for (const day of photosByDay) {
    dayStartIndices.set(day.dayId, globalIndex)
    globalIndex += day.photos.length
  }

  return (
    <div className="album-page">
      <div className="album-header">
        <div>
          <h1 className="album-title">{trip.title} のアルバム</h1>
          <p className="album-subtitle">{totalPhotos}枚の写真</p>
        </div>
        <div className="hero-actions-row no-print">
          <button className="btn-text" onClick={() => navigate(`/trips/${trip.id}`)}>
            ← 旅程に戻る
          </button>
          <button className="btn-text" onClick={() => window.print()}>
            印刷
          </button>
        </div>
      </div>

      {totalPhotos === 0 ? (
        <div className="album-empty">
          <p>まだ写真がありません</p>
          <p style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem' }}>
            旅程を編集して思い出の写真を追加しましょう
          </p>
        </div>
      ) : (
        photosByDay.map((day) => {
          const startIndex = dayStartIndices.get(day.dayId) || 0
          return (
            <section key={day.dayId} className="album-section">
              <div className="album-section-header">
                <span className="album-section-label">{day.dayLabel}</span>
                <span className="album-section-date">{day.dayDate}</span>
              </div>
              <div className="album-grid">
                {day.photos.map((photo, i) => (
                  <div
                    key={i}
                    className="album-item"
                    onClick={() => openLightbox(startIndex + i)}
                  >
                    <img src={photo.url} alt={photo.title} loading="lazy" />
                    <div className="album-item-caption">
                      {photo.time && <span className="album-item-time">{photo.time}</span>}
                      <span>{photo.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && allPhotos[lightboxIndex] && (
        <div
          className="album-lightbox"
          onClick={closeLightbox}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button className="album-lightbox-close no-print" onClick={closeLightbox}>
            ✕
          </button>
          {totalPhotos > 1 && (
            <>
              <button
                className="album-lightbox-nav prev no-print"
                onClick={(e) => {
                  e.stopPropagation()
                  prevPhoto()
                }}
              >
                ‹
              </button>
              <button
                className="album-lightbox-nav next no-print"
                onClick={(e) => {
                  e.stopPropagation()
                  nextPhoto()
                }}
              >
                ›
              </button>
            </>
          )}
          <img
            className="album-lightbox-img"
            src={allPhotos[lightboxIndex].url}
            alt={allPhotos[lightboxIndex].title}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
          <div className="album-lightbox-caption">
            <span>{allPhotos[lightboxIndex].dayLabel} — </span>
            {allPhotos[lightboxIndex].time && (
              <span>{allPhotos[lightboxIndex].time} </span>
            )}
            <span>{allPhotos[lightboxIndex].title}</span>
            {allPhotos[lightboxIndex].uploadedByName && (
              <span style={{ opacity: 0.8, marginLeft: 'var(--space-2)' }}>
                📷 {allPhotos[lightboxIndex].uploadedByName}
              </span>
            )}
            <span style={{ opacity: 0.6, marginLeft: 'var(--space-2)' }}>
              ({lightboxIndex + 1} / {totalPhotos})
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
