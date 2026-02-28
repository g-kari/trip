import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Trip, Item, ItemPhoto, DayPhoto, TripFeedback, FeedbackStats } from '../types'
import { formatDateRange, formatCost, formatDayLabel, isDayToday, getBudgetSummary } from '../utils'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../hooks/useAuth'
import { SkeletonHero, SkeletonDaySection } from '../components/Skeleton'
import { ShareButtons } from '../components/ShareButtons'
import { QRCode } from '../components/QRCode'
import { QRCodeModal } from '../components/QRCodeModal'
import { MapEmbed } from '../components/MapEmbed'
import { ReminderSettings } from '../components/ReminderSettings'
import { SettlementSummary } from '../components/SettlementSummary'
import { PackingList } from '../components/PackingList'
import { EditIcon, ShareIcon, CopyIcon, PrintIcon, ImageIcon, BellIcon, MoreVerticalIcon, TrashIcon, DownloadIcon } from '../components/Icons'
import { MarkdownText } from '../components/MarkdownText'
import { DayWeather } from '../components/DayWeather'
import { TravelModeIndicator } from '../components/TravelModeIndicator'
import { useTravelMode, formatCheckinTime } from '../hooks/useTravelMode'
import { OptimizeButton } from '../components/OptimizeButton'
import { CountdownWidget } from '../components/CountdownWidget'
import { CollapsibleSection } from '../components/CollapsibleSection'
import { FallbackImage } from '../components/FallbackImage'
import { BudgetSummaryCard } from '../components/BudgetSummaryCard'
import { StarRating } from '../components/StarRating'
import { useScrollReveal } from '../hooks/useScrollReveal'

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
  const [showQRModal, setShowQRModal] = useState(false)
  const [deletingItemPhoto, setDeletingItemPhoto] = useState<string | null>(null)
  const [deletingDayPhoto, setDeletingDayPhoto] = useState<string | null>(null)
  const [uploadingDayPhoto, setUploadingDayPhoto] = useState<string | null>(null)
  const [uploadingDayPhotoCount, setUploadingDayPhotoCount] = useState<number>(0)
  const dayPhotoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const [uploadingItemPhoto, setUploadingItemPhoto] = useState<string | null>(null)
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
  // Export dropdown state
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const exportDropdownRef = useRef<HTMLDivElement>(null)
  // Reminder modal state
  const [showReminderModal, setShowReminderModal] = useState(false)
  // Check-in state
  const [checkingInItem, setCheckingInItem] = useState<string | null>(null)
  const dayRefs = useRef<Map<string, HTMLElement>>(new Map())

  // Travel mode hook
  const { isTraveling, todayDayId, canCheckIn } = useTravelMode(trip)

  // Scroll reveal animation
  useScrollReveal(!loading && !!trip)

  // Jump to today's section
  const jumpToToday = useCallback(() => {
    if (todayDayId) {
      const dayElement = dayRefs.current.get(todayDayId)
      if (dayElement) {
        dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [todayDayId])

  // Check-in to an item
  async function handleCheckin(itemId: string) {
    if (!trip || !canCheckIn) return

    setCheckingInItem(itemId)
    try {
      // Try to get current location (optional)
      let location: { lat: number; lng: number } | undefined
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              enableHighAccuracy: false
            })
          })
          location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          }
        } catch {
          // Location not available, continue without it
        }
      }

      const res = await fetch(`/api/trips/${trip.id}/items/${itemId}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location })
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'チェックインに失敗しました')
        return
      }

      const data = await res.json() as { item: Item }
      // Update the item in trip state
      setTrip(prev => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items?.map(item =>
            item.id === itemId ? { ...item, ...data.item } : item
          )
        }
      })
      showSuccess('チェックインしました')
    } catch (err) {
      console.error('Check-in failed:', err)
      showError('チェックインに失敗しました')
    } finally {
      setCheckingInItem(null)
    }
  }

  // Remove check-in from an item
  async function handleRemoveCheckin(itemId: string) {
    if (!trip) return

    setCheckingInItem(itemId)
    try {
      const res = await fetch(`/api/trips/${trip.id}/items/${itemId}/checkin`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'チェックイン解除に失敗しました')
        return
      }

      const data = await res.json() as { item: Item }
      // Update the item in trip state
      setTrip(prev => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items?.map(item =>
            item.id === itemId ? { ...item, ...data.item } : item
          )
        }
      })
      showSuccess('チェックインを解除しました')
    } catch (err) {
      console.error('Remove check-in failed:', err)
      showError('チェックイン解除に失敗しました')
    } finally {
      setCheckingInItem(null)
    }
  }

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
            const userFeedback = data.feedback.find(fb => fb.isCurrentUser)
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

  // Delete item photo (supports both legacy single-photo and new multi-photo)
  async function deleteItemPhoto(item: Item, photo: ItemPhoto) {
    if (!trip || !user) return
    if (!confirm('この写真を削除しますか？')) return

    setDeletingItemPhoto(photo.id)
    try {
      // Legacy photos use the old endpoint, new photos use the per-photo endpoint
      const url = photo.id.startsWith('legacy-')
        ? `/api/trips/${trip.id}/items/${item.id}/photo`
        : `/api/trips/${trip.id}/items/${item.id}/photos/${photo.id}`
      const res = await fetch(url, {
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
      if (id) fetchTrip(id)
    } catch (err) {
      console.error('Failed to upload photo:', err)
      showError('写真のアップロードに失敗しました')
    } finally {
      setUploadingItemPhoto(null)
    }
  }

  // Check if user can delete item photo (owner can always delete, or uploader can delete their own)
  function canDeleteItemPhoto(item: Item, photo?: ItemPhoto): boolean {
    if (!user) return false
    // Trip owner can delete any photo
    if (isOwner) return true
    // For new multi-photo: check photo.uploadedBy
    if (photo) {
      return photo.uploadedBy === user.id
    }
    // Legacy single-photo fallback
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

      if (deletedFeedback?.isCurrentUser) {
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
    return feedback.isCurrentUser || isOwner
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

  const budgetSummary = getBudgetSummary(trip.items || [], trip.budget)
  const totalCost = getTotalCost()

  return (
    <>
      <section
        className={`hero ${trip.coverImageUrl ? 'hero-with-cover' : ''}`}
        style={trip.coverImageUrl ? { backgroundImage: `url(${trip.coverImageUrl})` } : undefined}
      >
        <h1 className="hero-title">{trip.title}</h1>
        {(trip.startDate || trip.endDate) && (
          <p className="hero-subtitle">
            {formatDateRange(trip.startDate, trip.endDate)}
          </p>
        )}
        <CountdownWidget
          startDate={trip.startDate}
          endDate={trip.endDate}
        />
        {shareToken && (
          <div className="hero-share-section no-print">
            <p className="share-section-title">この旅程を共有</p>
            <ShareButtons
              url={`${window.location.origin}/s/${shareToken}`}
              title={trip.title}
            />
          </div>
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
          <Link to={`/trips/${trip.id}/album`} className="btn-icon" title="アルバム">
            <ImageIcon size={16} />
          </Link>
          <div className="more-menu-wrapper" ref={exportDropdownRef}>
            <button
              className="btn-icon"
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              title="その他"
            >
              <MoreVerticalIcon size={16} />
            </button>
            {showExportDropdown && (
              <div className="more-menu-dropdown">
                <button className="more-menu-item" onClick={() => { setShowExportDropdown(false); printTrip() }}>
                  <PrintIcon size={14} /> 印刷
                </button>
                <button className="more-menu-item" onClick={() => { setShowExportDropdown(false); exportCalendar() }}>
                  <DownloadIcon size={14} /> カレンダー
                </button>
                {user && (
                  <button className="more-menu-item" onClick={() => { setShowExportDropdown(false); duplicateTrip() }}>
                    <CopyIcon size={14} /> 複製
                  </button>
                )}
                {isOwner && (
                  <>
                    <button className="more-menu-item" onClick={() => { setShowExportDropdown(false); setShowReminderModal(true) }}>
                      <BellIcon size={14} /> リマインダー
                    </button>
                    <hr className="more-menu-divider" />
                    <button className="more-menu-item" onClick={() => { setShowExportDropdown(false); exportData('json') }}>
                      <DownloadIcon size={14} /> JSON形式
                    </button>
                    <button className="more-menu-item" onClick={() => { setShowExportDropdown(false); exportData('csv') }}>
                      <DownloadIcon size={14} /> CSV形式（Excel）
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Map section */}
      <MapEmbed items={trip.items || []} />

      {/* Travel mode banner */}
      {isTraveling && (
        <TravelModeIndicator
          trip={trip}
          onJumpToToday={todayDayId ? jumpToToday : undefined}
        />
      )}

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
            const isToday = isDayToday(day.date)
            return (
              <section
                key={day.id}
                className={`day-section ${isToday ? 'is-today' : ''}`}
                data-reveal
                ref={(el) => { if (el) dayRefs.current.set(day.id, el) }}
              >
                <div className="day-header">
                  <span className="day-label">{label}</span>
                  <span className="day-date">{dateStr}</span>
                  {isToday && <span className="today-badge">今日</span>}
                  <DayWeather date={day.date} items={items} />
                  <OptimizeButton
                    tripId={trip.id}
                    day={day}
                    items={items}
                    onOptimized={() => { if (id) fetchTrip(id) }}
                    isOwner={isOwner}
                  />
                </div>
                {items.length === 0 ? (
                  <div className="timeline-item timeline-item-empty">
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
                      <span className="timeline-time">
                        {item.timeStart || '—'}
                        {item.timeEnd && <span className="timeline-time-end">〜{item.timeEnd}</span>}
                      </span>
                      <div className="timeline-item-checkin">
                        {canCheckIn && (isOwner || user) && (
                          <button
                            className={`checkin-btn no-print ${item.checkedInAt ? 'checked' : ''} ${checkingInItem === item.id ? 'loading' : ''}`}
                            onClick={() => item.checkedInAt ? handleRemoveCheckin(item.id) : handleCheckin(item.id)}
                            disabled={checkingInItem === item.id}
                            title={item.checkedInAt ? 'チェックイン解除' : 'チェックイン'}
                          />
                        )}
                        <div className="timeline-content">
                        <span className="timeline-title">
                          {item.title}
                          {item.checkedInAt && (
                            <span className="checkin-time">{formatCheckinTime(item.checkedInAt)}</span>
                          )}
                        </span>
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
                          <p className="timeline-note">
                            <MarkdownText text={item.note} />
                          </p>
                        )}
                        {item.photos && item.photos.length > 0 && (
                          <div className="item-photos-grid">
                            {item.photos.map((photo) => (
                              <div key={photo.id} className="item-photo-item">
                                <FallbackImage src={photo.photoUrl} alt="思い出の写真" className="memory-photo" />
                                {canDeleteItemPhoto(item, photo) && (
                                  <button
                                    className="item-photo-delete no-print"
                                    onClick={() => deleteItemPhoto(item, photo)}
                                    disabled={deletingItemPhoto === photo.id}
                                    title="写真を削除"
                                  >
                                    {deletingItemPhoto === photo.id ? '...' : '×'}
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
                          <div className="photo-upload-section no-print">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: 'none' }}
                              ref={(el) => {
                                if (el) itemPhotoInputRefs.current.set(item.id, el)
                              }}
                              onChange={(e) => {
                                const files = e.target.files
                                if (files) {
                                  for (const file of Array.from(files)) {
                                    uploadItemPhoto(item.id, file)
                                  }
                                }
                                e.target.value = ''
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
                            <FallbackImage src={photo.photoUrl} alt="思い出の写真" className="day-photo" />
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
              </section>
            )
          })
      )}

      {/* Budget Summary (collapsible) */}
      {budgetSummary && (budgetSummary.totalSpent > 0 || budgetSummary.totalBudget) && (
        <CollapsibleSection title="予算・費用" subtitle={`合計 ${formatCost(totalCost)}`}>
          <BudgetSummaryCard summary={budgetSummary} />
        </CollapsibleSection>
      )}

      {totalCost > 0 && !trip?.budget && !budgetSummary?.totalBudget && (
        <CollapsibleSection title="費用" subtitle={formatCost(totalCost)}>
          <div className="total-cost">
            <span className="total-cost-label">合計費用</span>
            <span className="total-cost-value">{formatCost(totalCost)}</span>
          </div>
        </CollapsibleSection>
      )}

      {/* Settlement Summary (collapsible) */}
      {trip && (
        <CollapsibleSection title="精算">
          <SettlementSummary tripId={trip.id} />
        </CollapsibleSection>
      )}

      {/* Packing List (collapsible, read-only for viewers) */}
      {trip && (
        <CollapsibleSection title="持ち物リスト">
          <PackingList tripId={trip.id} readOnly={!isOwner} />
        </CollapsibleSection>
      )}

      {/* Feedback Section (collapsible) */}
      <CollapsibleSection
        title="フィードバック"
        subtitle={feedbackStats.count > 0 ? `★ ${feedbackStats.averageRating}（${feedbackStats.count}件）` : undefined}
      >
        <section className="feedback-section">
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
      </CollapsibleSection>

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
              <button
                type="button"
                className="share-qr-button"
                onClick={() => setShowQRModal(true)}
                title="クリックで拡大・ダウンロード"
              >
                <QRCode value={`${window.location.origin}/s/${shareToken}`} size={150} />
                <span className="share-qr-hint">タップして拡大・ダウンロード</span>
              </button>
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

      {/* QR Code modal */}
      {showQRModal && shareToken && (
        <QRCodeModal
          url={`${window.location.origin}/s/${shareToken}`}
          title={trip.title}
          onClose={() => setShowQRModal(false)}
        />
      )}
    </>
  )
}
