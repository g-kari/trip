import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import type { Trip, Item, TripFeedback, FeedbackStats, BudgetSummary, CostCategory } from '../types'
import { COST_CATEGORIES } from '../types'
import { formatDateRange, formatCost, formatDayDate } from '../utils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { SkeletonHero, SkeletonDaySection } from '../components/Skeleton'
import { ShareButtons } from '../components/ShareButtons'
import { MapEmbed } from '../components/MapEmbed'
import { MarkdownText } from '../components/MarkdownText'

// Budget summary component
function BudgetSummaryCard({ summary }: { summary: BudgetSummary }) {
  const formatCostLocal = (cost: number) => `¥${cost.toLocaleString()}`

  return (
    <div className="budget-summary-card">
      <h3 className="budget-summary-title">予算サマリー</h3>

      {/* Budget overview */}
      <div className="budget-overview">
        <div className="budget-row">
          <span className="budget-label">合計費用</span>
          <span className="budget-value">{formatCostLocal(summary.totalSpent)}</span>
        </div>
        {summary.totalBudget !== null && (
          <>
            <div className="budget-row">
              <span className="budget-label">予算</span>
              <span className="budget-value">{formatCostLocal(summary.totalBudget)}</span>
            </div>
            <div className="budget-row">
              <span className="budget-label">残り</span>
              <span className={`budget-value ${summary.isOverBudget ? 'budget-over' : 'budget-under'}`}>
                {summary.remaining !== null && (summary.remaining >= 0 ? formatCostLocal(summary.remaining) : `-${formatCostLocal(Math.abs(summary.remaining))}`)}
              </span>
            </div>
            {/* Progress bar */}
            <div className="budget-progress-container">
              <div
                className={`budget-progress-bar ${summary.isOverBudget ? 'over' : ''}`}
                style={{ width: `${Math.min((summary.totalSpent / summary.totalBudget) * 100, 100)}%` }}
              />
            </div>
            {summary.isOverBudget && (
              <div className="budget-warning">
                予算を超過しています
              </div>
            )}
          </>
        )}
      </div>

      {/* Category breakdown */}
      {summary.byCategory.length > 0 && (
        <div className="budget-categories">
          <h4 className="budget-categories-title">カテゴリ別内訳</h4>
          {summary.byCategory.map((cat) => (
            <div key={cat.category} className="budget-category-row">
              <span className="budget-category-name">{cat.category}</span>
              <div className="budget-category-bar-container">
                <div
                  className="budget-category-bar"
                  style={{ width: `${cat.percentage}%` }}
                />
              </div>
              <span className="budget-category-amount">{formatCostLocal(cat.amount)}</span>
              <span className="budget-category-percent">{cat.percentage}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Star rating component
function StarRating({ rating, onRate, readonly = false }: {
  rating: number
  onRate?: (rating: number) => void
  readonly?: boolean
}) {
  const [hoverRating, setHoverRating] = useState(0)

  return (
    <div className="star-rating" onMouseLeave={() => setHoverRating(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`star-btn ${readonly ? 'readonly' : ''}`}
          onClick={() => !readonly && onRate?.(star)}
          onMouseEnter={() => !readonly && setHoverRating(star)}
          disabled={readonly}
        >
          <span className={`star ${(hoverRating || rating) >= star ? 'filled' : ''}`}>
            {(hoverRating || rating) >= star ? '\u2605' : '\u2606'}
          </span>
        </button>
      ))}
    </div>
  )
}

// Format date for feedback
function formatFeedbackDate(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

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
  // Feedback state
  const [feedbackList, setFeedbackList] = useState<TripFeedback[]>([])
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats>({ count: 0, averageRating: 0 })
  const [feedbackName, setFeedbackName] = useState('')
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [deletingFeedbackId, setDeletingFeedbackId] = useState<string | null>(null)
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false)

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

  // Fetch feedback
  useEffect(() => {
    async function fetchFeedback() {
      if (!token) return
      try {
        const res = await fetch(`/api/shared/${token}/feedback`)
        if (res.ok) {
          const data = await res.json() as { feedback: TripFeedback[]; stats: FeedbackStats }
          setFeedbackList(data.feedback)
          setFeedbackStats(data.stats)
          // Check if current user has already submitted
          if (user) {
            const userFeedback = data.feedback.find(fb => fb.userId === user.id)
            setHasSubmittedFeedback(!!userFeedback)
          }
        }
      } catch {
        // ignore
      }
    }
    fetchFeedback()
  }, [token, user])

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

  // Calculate budget summary
  function getBudgetSummary(): BudgetSummary | null {
    if (!trip) return null

    const totalSpent = items.reduce((sum, item) => sum + (item.cost || 0), 0)
    const totalBudget = trip.budget

    // Calculate category breakdown
    const categoryTotals = new Map<CostCategory, number>()
    for (const cat of COST_CATEGORIES) {
      categoryTotals.set(cat, 0)
    }

    for (const item of items) {
      if (item.cost && item.cost > 0) {
        const category = (item.costCategory || 'その他') as CostCategory
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + item.cost)
      }
    }

    const byCategory = COST_CATEGORIES
      .map((category) => ({
        category,
        amount: categoryTotals.get(category) || 0,
        percentage: totalSpent > 0 ? Math.round(((categoryTotals.get(category) || 0) / totalSpent) * 100) : 0,
      }))
      .filter((c) => c.amount > 0)

    return {
      totalBudget,
      totalSpent,
      remaining: totalBudget ? totalBudget - totalSpent : null,
      isOverBudget: totalBudget ? totalSpent > totalBudget : false,
      byCategory,
    }
  }

  const budgetSummary = getBudgetSummary()

  async function duplicateTrip() {
    if (!trip) return
    if (!confirm('この旅程を複製しますか？')) return

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

  // Submit feedback
  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault()
    if (!token || feedbackRating === 0) {
      showError('評価を選択してください')
      return
    }
    if (!user && !feedbackName.trim()) {
      showError('お名前を入力してください')
      return
    }

    setSubmittingFeedback(true)
    try {
      const res = await fetch(`/api/shared/${token}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user ? undefined : feedbackName.trim(),
          rating: feedbackRating,
          comment: feedbackComment.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        if (res.status === 409) {
          showError('既にフィードバックを投稿しています')
          setHasSubmittedFeedback(true)
          return
        }
        showError(data.error || 'フィードバックの送信に失敗しました')
        return
      }

      const data = await res.json() as { feedback: TripFeedback }
      setFeedbackList([data.feedback, ...feedbackList])
      setFeedbackStats({
        count: feedbackStats.count + 1,
        averageRating: Math.round(((feedbackStats.averageRating * feedbackStats.count) + feedbackRating) / (feedbackStats.count + 1) * 10) / 10,
      })
      setFeedbackName('')
      setFeedbackRating(0)
      setFeedbackComment('')
      setHasSubmittedFeedback(true)
      showSuccess('フィードバックを送信しました')
    } catch (err) {
      console.error('Failed to submit feedback:', err)
      showError('フィードバックの送信に失敗しました')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  // Delete feedback
  async function deleteFeedback(feedbackId: string) {
    if (!confirm('このフィードバックを削除しますか？')) return

    setDeletingFeedbackId(feedbackId)
    try {
      const res = await fetch(`/api/feedback/${feedbackId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'フィードバックの削除に失敗しました')
        return
      }

      const deletedFeedback = feedbackList.find(fb => fb.id === feedbackId)
      const newList = feedbackList.filter(fb => fb.id !== feedbackId)
      setFeedbackList(newList)

      // Recalculate stats
      if (deletedFeedback && feedbackStats.count > 1) {
        const newTotal = (feedbackStats.averageRating * feedbackStats.count) - deletedFeedback.rating
        setFeedbackStats({
          count: feedbackStats.count - 1,
          averageRating: Math.round((newTotal / (feedbackStats.count - 1)) * 10) / 10,
        })
      } else {
        setFeedbackStats({ count: 0, averageRating: 0 })
      }

      if (deletedFeedback?.userId === user?.id) {
        setHasSubmittedFeedback(false)
      }

      showSuccess('フィードバックを削除しました')
    } catch (err) {
      console.error('Failed to delete feedback:', err)
      showError('フィードバックの削除に失敗しました')
    } finally {
      setDeletingFeedbackId(null)
    }
  }

  // Check if user can delete feedback
  function canDeleteFeedback(feedback: TripFeedback): boolean {
    if (!user) return false
    // User can delete their own feedback or trip owner can delete any
    return feedback.userId === user.id || tripOwnerId === user.id
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
            <button className="btn-text" onClick={() => window.open(`/api/shared/${token}/calendar.ics`, '_blank')}>カレンダー</button>
            <button className="btn-text" onClick={duplicateTrip}>
              {user ? '複製' : '複製してログイン'}
            </button>
          </div>
          <div className="hero-share-section no-print">
            <p className="share-section-title">この旅程を共有</p>
            <ShareButtons
              url={window.location.href}
              title={trip.title}
            />
          </div>
        </section>

        {/* Map section */}
        <MapEmbed items={items} />

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
                        <p className="timeline-note">
                          <MarkdownText text={item.note} />
                        </p>
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

        {/* Budget Summary */}
        {budgetSummary && (budgetSummary.totalSpent > 0 || budgetSummary.totalBudget) && (
          <BudgetSummaryCard summary={budgetSummary} />
        )}

        {totalCost > 0 && !trip?.budget && (
          <div className="total-cost">
            <span className="total-cost-label">合計</span>
            <span className="total-cost-value">{formatCost(totalCost)}</span>
          </div>
        )}

        {/* Feedback Section */}
        <section className="feedback-section no-print">
          <div className="feedback-header">
            <h2 className="feedback-title">フィードバック</h2>
            {feedbackStats.count > 0 && (
              <div className="feedback-summary">
                <StarRating rating={Math.round(feedbackStats.averageRating)} readonly />
                <span className="feedback-average">{feedbackStats.averageRating}</span>
                <span className="feedback-count">({feedbackStats.count}件)</span>
              </div>
            )}
          </div>

          {/* Feedback Form */}
          {!hasSubmittedFeedback && (
            <form className="feedback-form" onSubmit={submitFeedback}>
              <div className="feedback-form-rating">
                <label className="feedback-form-label">評価</label>
                <StarRating rating={feedbackRating} onRate={setFeedbackRating} />
              </div>

              {!user && (
                <div className="feedback-form-field">
                  <label className="feedback-form-label">お名前</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="お名前（必須）"
                    value={feedbackName}
                    onChange={(e) => setFeedbackName(e.target.value)}
                    maxLength={50}
                  />
                </div>
              )}

              <div className="feedback-form-field">
                <label className="feedback-form-label">コメント（任意）</label>
                <textarea
                  className="input textarea"
                  placeholder="旅程の感想を書いてください..."
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              </div>

              <button
                type="submit"
                className="btn-filled"
                disabled={submittingFeedback || feedbackRating === 0}
              >
                {submittingFeedback ? '送信中...' : 'フィードバックを送信'}
              </button>
            </form>
          )}

          {hasSubmittedFeedback && (
            <p className="feedback-submitted-message">
              フィードバックを送信済みです
            </p>
          )}

          {/* Feedback List */}
          {feedbackList.length > 0 && (
            <div className="feedback-list">
              {feedbackList.map((feedback) => (
                <div key={feedback.id} className="feedback-card">
                  <div className="feedback-card-header">
                    <span className="feedback-card-name">{feedback.name}</span>
                    <StarRating rating={feedback.rating} readonly />
                    <span className="feedback-card-date">
                      {formatFeedbackDate(feedback.createdAt)}
                    </span>
                    {canDeleteFeedback(feedback) && (
                      <button
                        className="btn-text btn-small btn-danger"
                        onClick={() => deleteFeedback(feedback.id)}
                        disabled={deletingFeedbackId === feedback.id}
                      >
                        {deletingFeedbackId === feedback.id ? '...' : '削除'}
                      </button>
                    )}
                  </div>
                  {feedback.comment && (
                    <p className="feedback-card-comment">{feedback.comment}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {feedbackList.length === 0 && !hasSubmittedFeedback && (
            <p className="feedback-empty">
              まだフィードバックがありません。最初のフィードバックを投稿してみてください。
            </p>
          )}
        </section>

      </main>

      <footer className="footer">
        <Link to="/" className="footer-text" style={{ textDecoration: 'none' }}>
          旅程で作成
        </Link>
      </footer>
    </div>
  )
}
