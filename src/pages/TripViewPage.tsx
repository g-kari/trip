import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Trip, Item, DayPhoto, TripFeedback, FeedbackStats, BudgetSummary, CostCategory } from '../types'
import { COST_CATEGORIES } from '../types'
import { formatDateRange, formatCost, formatDayLabel } from '../utils'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../hooks/useAuth'
import { SkeletonHero, SkeletonDaySection } from '../components/Skeleton'
import { ShareButtons } from '../components/ShareButtons'
import { QRCode } from '../components/QRCode'
import { MapEmbed } from '../components/MapEmbed'
import { ReminderSettings } from '../components/ReminderSettings'
import { SettlementSummary } from '../components/SettlementSummary'
import { PackingList } from '../components/PackingList'
import { EditIcon, ShareIcon, CopyIcon, PrintIcon, ImageIcon, BellIcon, MoreVerticalIcon, TrashIcon } from '../components/Icons'

// Budget summary component
function BudgetSummaryCard({ summary }: { summary: BudgetSummary }) {
  const { formatCost } = { formatCost: (cost: number) => `¥${cost.toLocaleString()}` }

  return (
    <div className="budget-summary-card">
      <h3 className="budget-summary-title">予算サマリー</h3>

      {/* Budget overview */}
      <div className="budget-overview">
        <div className="budget-row">
          <span className="budget-label">合計費用</span>
          <span className="budget-value">{formatCost(summary.totalSpent)}</span>
        </div>
        {summary.totalBudget !== null && (
          <>
            <div className="budget-row">
              <span className="budget-label">予算</span>
              <span className="budget-value">{formatCost(summary.totalBudget)}</span>
            </div>
            <div className="budget-row">
              <span className="budget-label">残り</span>
              <span className={`budget-value ${summary.isOverBudget ? 'budget-over' : 'budget-under'}`}>
                {summary.remaining !== null && (summary.remaining >= 0 ? formatCost(summary.remaining) : `-${formatCost(Math.abs(summary.remaining))}`)}
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
              <span className="budget-category-amount">{formatCost(cat.amount)}</span>
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
  // Feedback state
  const [feedbackList, setFeedbackList] = useState<TripFeedback[]>([])
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats>({ count: 0, averageRating: 0 })
  const [feedbackName, setFeedbackName] = useState('')
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [deletingFeedbackId, setDeletingFeedbackId] = useState<string | null>(null)
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false)
  // Export dropdown state
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const exportDropdownRef = useRef<HTMLDivElement>(null)
  // Reminder modal state
  const [showReminderModal, setShowReminderModal] = useState(false)

  // Close export dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false)
      }
    }
    if (showExportDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showExportDropdown])

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

  // Fetch feedback
  useEffect(() => {
    async function fetchFeedback() {
      if (!id) return
      try {
        const res = await fetch(`/api/trips/${id}/feedback`)
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
  }, [id, user])

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

  function printTrip() {
    window.print()
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

  function exportData(format: 'json' | 'csv') {
    if (!trip) return
    setShowExportDropdown(false)
    window.open(`/api/trips/${trip.id}/export?format=${format}`, '_blank')
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

  function getBudgetSummary(): BudgetSummary | null {
    if (!trip) return null

    const items = trip.items || []
    const totalSpent = items.reduce((sum, item) => sum + (item.cost || 0), 0)
    const totalBudget = trip.budget

    // Calculate category breakdown
    const categoryTotals = new Map<CostCategory, number>()
    for (const cat of COST_CATEGORIES) {
      categoryTotals.set(cat, 0)
    }

    for (const item of items) {
      if (item.cost && item.cost > 0) {
        const category = item.costCategory || 'その他'
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

  // Submit feedback
  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault()
    if (!id || feedbackRating === 0) {
      showError('評価を選択してください')
      return
    }
    if (!user && !feedbackName.trim()) {
      showError('お名前を入力してください')
      return
    }

    setSubmittingFeedback(true)
    try {
      const res = await fetch(`/api/trips/${id}/feedback`, {
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
    return feedback.userId === user.id || isOwner
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
              <Link to={`/trips/${trip.id}/edit`} className="btn-icon" title="編集">
                <EditIcon size={16} />
              </Link>
              <button className="btn-icon" onClick={createShareLink} title="共有">
                <ShareIcon size={16} />
              </button>
            </>
          )}
          <button className="btn-icon" onClick={printTrip} title="印刷">
            <PrintIcon size={16} />
          </button>
          {user && (
            <button className="btn-icon" onClick={duplicateTrip} title="複製">
              <CopyIcon size={16} />
            </button>
          )}
          <Link to={`/trips/${trip.id}/album`} className="btn-icon" title="アルバム">
            <ImageIcon size={16} />
          </Link>
          <button className="btn-icon" onClick={() => setShowReminderModal(true)} title="リマインダー">
            <BellIcon size={16} />
          </button>
          {isOwner && (
            <div className="export-dropdown-container" ref={exportDropdownRef}>
              <button
                className="btn-icon"
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                title="その他"
              >
                <MoreVerticalIcon size={16} />
              </button>
              {showExportDropdown && (
                <div className="export-dropdown">
                  <button className="export-dropdown-item" onClick={exportCalendar}>
                    カレンダー
                  </button>
                  <button className="export-dropdown-item" onClick={() => exportData('json')}>
                    JSON形式
                  </button>
                  <button className="export-dropdown-item" onClick={() => exportData('csv')}>
                    CSV形式（Excel）
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Map section */}
      <MapEmbed items={trip.items || []} />

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

      {/* Budget Summary */}
      {getBudgetSummary() && (getBudgetSummary()!.totalSpent > 0 || getBudgetSummary()!.totalBudget) && (
        <BudgetSummaryCard summary={getBudgetSummary()!} />
      )}

      {getTotalCost() > 0 && !trip?.budget && (
        <div className="total-cost">
          <span className="total-cost-label">合計費用</span>
          <span className="total-cost-value">{formatCost(getTotalCost())}</span>
        </div>
      )}

      {/* Settlement Summary */}
      {trip && (
        <SettlementSummary tripId={trip.id} />
      )}

      {/* Packing List (read-only for viewers) */}
      {trip && (
        <PackingList tripId={trip.id} readOnly={!isOwner} />
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
                      className="btn-icon btn-danger"
                      onClick={() => deleteFeedback(feedback.id)}
                      disabled={deletingFeedbackId === feedback.id}
                      title="削除"
                    >
                      {deletingFeedbackId === feedback.id ? '...' : <TrashIcon size={14} />}
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
            <div className="share-qr-section">
              <p className="share-section-title">QRコードをスキャン</p>
              <QRCode value={`${window.location.origin}/s/${shareToken}`} size={150} />
            </div>
            <p className="share-section-title">SNSで共有</p>
            <ShareButtons
              url={`${window.location.origin}/s/${shareToken}`}
              title={trip.title}
            />
            <div className="modal-actions" style={{ marginTop: 'var(--space-4)' }}>
              <button className="btn-text btn-danger" onClick={deleteShareLink}>
                リンクを削除
              </button>
            </div>
            <button className="btn-text modal-close" onClick={() => setShowShareModal(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Reminder settings modal */}
      {showReminderModal && (
        <ReminderSettings
          trip={trip}
          onClose={() => setShowReminderModal(false)}
        />
      )}
    </>
  )
}
