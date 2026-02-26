import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Trip, Day, Item, TripTheme, CostCategory } from '../types'
import { COST_CATEGORIES } from '../types'
import { formatDateRange, formatCost, formatDayLabel, generateMapUrl } from '../utils'
import { useDebounce } from '../hooks/useDebounce'
import { useToast } from '../hooks/useToast'
import { DatePicker } from '../components/DatePicker'
import { TimePicker } from '../components/TimePicker'
import { ReminderSettings } from '../components/ReminderSettings'
import { CollaboratorManager } from '../components/CollaboratorManager'
import { TripMemberManager } from '../components/ExpenseSplitter'
import { SettlementSummary } from '../components/SettlementSummary'
import { PackingList } from '../components/PackingList'
import type { TripMember } from '../types'

// Active editor type for collaborative editing
type ActiveEditor = {
  userId: string
  lastActiveAt: string
  userName: string | null
  avatarUrl: string | null
}

// Draggable item component using HTML5 Drag and Drop API
function DraggableItem({
  item,
  dayId,
  tripId,
  editingItem,
  onStartEdit,
  onDelete,
  editItemTime,
  setEditItemTime,
  editItemTitle,
  setEditItemTitle,
  editItemArea,
  setEditItemArea,
  editItemCost,
  setEditItemCost,
  editItemCostCategory,
  setEditItemCostCategory,
  editItemNote,
  setEditItemNote,
  editItemMapUrl,
  setEditItemMapUrl,
  savingItem,
  onCancelEdit,
  onSubmitEdit,
  onPhotoUploaded,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragging,
  isDragOver,
}: {
  item: Item
  dayId: string
  tripId: string
  editingItem: Item | null
  onStartEdit: (item: Item) => void
  onDelete: (id: string) => void
  editItemTime: string
  setEditItemTime: (v: string) => void
  editItemTitle: string
  setEditItemTitle: (v: string) => void
  editItemArea: string
  setEditItemArea: (v: string) => void
  editItemCost: string
  setEditItemCost: (v: string) => void
  editItemCostCategory: CostCategory | ''
  setEditItemCostCategory: (v: CostCategory | '') => void
  editItemNote: string
  setEditItemNote: (v: string) => void
  editItemMapUrl: string
  setEditItemMapUrl: (v: string) => void
  savingItem: boolean
  onCancelEdit: () => void
  onSubmitEdit: (e: React.FormEvent) => void
  onPhotoUploaded: () => void
  onDragStart: (e: React.DragEvent, itemId: string, dayId: string) => void
  onDragOver: (e: React.DragEvent, itemId: string, dayId: string) => void
  onDragEnd: () => void
  onDrop: (e: React.DragEvent, targetItemId: string, targetDayId: string) => void
  isDragging: boolean
  isDragOver: boolean
}) {
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)

  async function uploadItemPhoto(file: File) {
    if (!file.type.startsWith('image/')) {
      alert('画像ファイルを選択してください')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('ファイルサイズは5MB以下にしてください')
      return
    }

    setUploadingPhoto(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/items/${item.id}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!res.ok) throw new Error('Upload failed')
      onPhotoUploaded()
    } catch (err) {
      console.error('Failed to upload photo:', err)
      alert('写真のアップロードに失敗しました')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function deleteItemPhoto() {
    if (!confirm('この写真を削除しますか？')) return
    try {
      await fetch(`/api/trips/${tripId}/items/${item.id}/photo`, { method: 'DELETE' })
      onPhotoUploaded()
    } catch (err) {
      console.error('Failed to delete photo:', err)
    }
  }

  // Touch event handlers for long-press drag on mobile
  function handleTouchStart() {
    if (editingItem?.id === item.id) return

    longPressTimer.current = setTimeout(() => {
      // Trigger a visual feedback and enable dragging
      if (itemRef.current) {
        itemRef.current.setAttribute('draggable', 'true')
        // Simulate drag start for visual feedback
        itemRef.current.classList.add('touch-dragging')
      }
    }, 500) // 500ms long press
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (itemRef.current) {
      itemRef.current.classList.remove('touch-dragging')
    }
  }

  function handleTouchMove() {
    // Cancel long press if finger moves
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  return (
    <div
      ref={itemRef}
      className={`timeline-item ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
      draggable={editingItem?.id !== item.id}
      onDragStart={(e) => onDragStart(e, item.id, dayId)}
      onDragOver={(e) => onDragOver(e, item.id, dayId)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, item.id, dayId)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      {editingItem?.id === item.id ? (
        <form className="edit-item-form no-print" onSubmit={onSubmitEdit}>
          <div className="form-row">
            <TimePicker
              value={editItemTime}
              onChange={setEditItemTime}
              placeholder="時刻"
              className="input-small"
            />
            <input
              type="text"
              value={editItemTitle}
              onChange={(e) => setEditItemTitle(e.target.value)}
              className="input"
              placeholder="タイトル"
              autoFocus
            />
          </div>
          <div className="form-row">
            <input
              type="text"
              value={editItemArea}
              onChange={(e) => setEditItemArea(e.target.value)}
              className="input"
              placeholder="エリア"
            />
            <input
              type="number"
              value={editItemCost}
              onChange={(e) => setEditItemCost(e.target.value)}
              className="input input-small"
              placeholder="費用"
            />
          </div>
          <div className="form-row">
            <select
              value={editItemCostCategory}
              onChange={(e) => setEditItemCostCategory(e.target.value as CostCategory | '')}
              className="input"
            >
              <option value="">カテゴリを選択</option>
              {COST_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={editItemNote}
            onChange={(e) => setEditItemNote(e.target.value)}
            className="input"
            placeholder="メモ"
          />
          <input
            type="url"
            value={editItemMapUrl}
            onChange={(e) => setEditItemMapUrl(e.target.value)}
            className="input"
            placeholder="地図URL（Google Maps等）"
          />
          <div className="form-actions">
            <button type="button" className="btn-text" onClick={onCancelEdit}>
              キャンセル
            </button>
            <button type="submit" className="btn-filled" disabled={savingItem || !editItemTitle.trim()}>
              {savingItem ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <span
            className="timeline-time drag-handle"
            title="ドラッグで並び替え"
          >
            {item.timeStart || '—'}
          </span>
          <div className="timeline-content">
            <span className="timeline-title">{item.title}</span>
            <div className="timeline-meta">
              {item.area && <span>{item.area}</span>}
              {item.cost != null && item.cost > 0 && (
                <span>{formatCost(item.cost)}{item.costCategory && ` (${item.costCategory})`}</span>
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
            {/* Item photo (memory) */}
            {item.photoUrl && (
              <div className="item-photo">
                <img src={item.photoUrl} alt="思い出の写真" className="memory-photo" />
                {item.photoUploadedByName && (
                  <span className="photo-uploader">📷 {item.photoUploadedByName}</span>
                )}
              </div>
            )}
            <div className="item-actions no-print">
              <button className="btn-text btn-small" onClick={() => onStartEdit(item)}>
                編集
              </button>
              {item.photoUrl ? (
                <button className="btn-text btn-small" onClick={deleteItemPhoto}>
                  写真削除
                </button>
              ) : (
                <button
                  className="btn-text btn-small"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? '...' : '写真追加'}
                </button>
              )}
              <button className="btn-text btn-small btn-danger" onClick={() => onDelete(item.id)}>
                削除
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadItemPhoto(file)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Day notes section (その他)
function DayNotesSection({
  day,
  tripId,
  onUpdated,
}: {
  day: Day
  tripId: string
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(day.notes || '')
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingPhotoCount, setUploadingPhotoCount] = useState(0)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Update local state when day changes
  useEffect(() => {
    setNotes(day.notes || '')
  }, [day.notes])

  async function saveNotes() {
    setSaving(true)
    try {
      await fetch(`/api/trips/${tripId}/days/${day.id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      setEditing(false)
      onUpdated()
    } catch (err) {
      console.error('Failed to save notes:', err)
    } finally {
      setSaving(false)
    }
  }

  async function uploadPhotos(files: FileList) {
    // Validate all files first
    const validFiles: File[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        alert(`${file.name}: 画像ファイルを選択してください`)
        continue
      }
      if (file.size > 5 * 1024 * 1024) {
        alert(`${file.name}: ファイルサイズは5MB以下にしてください`)
        continue
      }
      validFiles.push(file)
    }

    if (validFiles.length === 0) return

    setUploadingPhoto(true)
    setUploadingPhotoCount(validFiles.length)

    try {
      // Upload all files in parallel
      const uploadPromises = validFiles.map(async (file) => {
        const res = await fetch(`/api/trips/${tripId}/days/${day.id}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!res.ok) {
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
        alert(errors[0])
      }

      if (succeeded > 0) {
        onUpdated()
      }
    } catch (err) {
      console.error('Failed to upload photos:', err)
      alert('写真のアップロードに失敗しました')
    } finally {
      setUploadingPhoto(false)
      setUploadingPhotoCount(0)
    }
  }

  async function deletePhoto(photoId: string) {
    if (!confirm('この写真を削除しますか？')) return

    // Handle legacy IDs that start with 'legacy-'
    let actualPhotoId = photoId
    if (photoId.startsWith('legacy-')) {
      // For legacy photos, extract from the ID pattern: legacy-{dayId}-{index}
      // We need the photo URL to extract the actual ID
      const photo = day.photos.find(p => p.id === photoId)
      if (photo) {
        const parts = photo.photoUrl.split('/')
        const photoIdWithExt = parts[parts.length - 1]
        actualPhotoId = photoIdWithExt.split('.')[0]
      }
    }

    try {
      await fetch(`/api/trips/${tripId}/days/${day.id}/photos/${actualPhotoId}`, { method: 'DELETE' })
      onUpdated()
    } catch (err) {
      console.error('Failed to delete photo:', err)
    }
  }

  const hasContent = (day.notes && day.notes.trim()) || (day.photos && day.photos.length > 0)

  return (
    <div className="day-notes-section">
      <div className="day-notes-header">
        <span className="day-notes-label">その他</span>
      </div>

      {/* Notes */}
      {editing ? (
        <div className="day-notes-edit no-print">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input textarea"
            placeholder="この日のメモを入力..."
            rows={3}
          />
          <div className="form-actions">
            <button type="button" className="btn-text" onClick={() => setEditing(false)}>
              キャンセル
            </button>
            <button type="button" className="btn-filled" onClick={saveNotes} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {day.notes && (
            <p className="day-notes-text">{day.notes}</p>
          )}
          <button className="btn-text btn-small no-print" onClick={() => setEditing(true)}>
            {day.notes ? 'メモを編集' : '+ メモを追加'}
          </button>
        </>
      )}

      {/* Photos */}
      {day.photos && day.photos.length > 0 && (
        <div className="day-photos-grid">
          {day.photos.map((photo) => (
            <div key={photo.id} className="day-photo-item">
              <img src={photo.photoUrl} alt="思い出の写真" className="day-photo" />
              {photo.uploadedByName && (
                <span className="photo-uploader">📷 {photo.uploadedByName}</span>
              )}
              <button
                className="btn-text btn-small btn-danger day-photo-delete no-print"
                onClick={() => deletePhoto(photo.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add photo button */}
      <button
        className="btn-text btn-small no-print"
        onClick={() => photoInputRef.current?.click()}
        disabled={uploadingPhoto}
        style={{ marginTop: hasContent ? 'var(--space-2)' : 0 }}
      >
        {uploadingPhoto ? `${uploadingPhotoCount}枚アップロード中...` : '+ 写真を追加（複数可）'}
      </button>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length > 0) {
            uploadPhotos(files)
          }
          e.target.value = ''
        }}
      />
    </div>
  )
}

export function TripEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError, showSuccess } = useToast()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Drag and drop state (HTML5 API)
  const [draggedItem, setDraggedItem] = useState<{ itemId: string; dayId: string } | null>(null)
  const [dragOverItem, setDragOverItem] = useState<{ itemId: string; dayId: string } | null>(null)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

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

  // Trip edit state
  const [editTripTitle, setEditTripTitle] = useState('')
  const [editTripStartDate, setEditTripStartDate] = useState('')
  const [editTripEndDate, setEditTripEndDate] = useState('')
  const [editTripTheme, setEditTripTheme] = useState<TripTheme>('quiet')
  const [editTripBudget, setEditTripBudget] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Day form state
  const [showDayForm, setShowDayForm] = useState(false)
  const [newDayDate, setNewDayDate] = useState('')
  const [creatingDay, setCreatingDay] = useState(false)
  const [bulkDayMode, setBulkDayMode] = useState(false)
  const [bulkStartDate, setBulkStartDate] = useState('')
  const [bulkEndDate, setBulkEndDate] = useState('')

  // Item form state
  const [showItemFormForDay, setShowItemFormForDay] = useState<string | null>(null)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemTime, setNewItemTime] = useState('')
  const [newItemArea, setNewItemArea] = useState('')
  const [newItemNote, setNewItemNote] = useState('')
  const [newItemCost, setNewItemCost] = useState('')
  const [newItemCostCategory, setNewItemCostCategory] = useState<CostCategory | ''>('')
  const [newItemMapUrl, setNewItemMapUrl] = useState('')
  const [creatingItem, setCreatingItem] = useState(false)

  // Edit item state
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [editItemTitle, setEditItemTitle] = useState('')
  const [editItemTime, setEditItemTime] = useState('')
  const [editItemArea, setEditItemArea] = useState('')
  const [editItemNote, setEditItemNote] = useState('')
  const [editItemCost, setEditItemCost] = useState('')
  const [editItemCostCategory, setEditItemCostCategory] = useState<CostCategory | ''>('')
  const [editItemMapUrl, setEditItemMapUrl] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  // Trip members for expense splitting
  const [tripMembers, setTripMembers] = useState<TripMember[]>([])
  const [showMemberManager, setShowMemberManager] = useState(false)

  // Auto-generate days state
  const [generatingDays, setGeneratingDays] = useState(false)

  // Cover image state
  const [uploadingCover, setUploadingCover] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // Template state
  const [isTemplate, setIsTemplate] = useState(false)
  const [templateUses, setTemplateUses] = useState(0)
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Reminder modal state
  const [showReminderModal, setShowReminderModal] = useState(false)

  // Collaborator modal state
  const [showCollaboratorModal, setShowCollaboratorModal] = useState(false)

  // Active editors (collaborative editing)
  const [activeEditors, setActiveEditors] = useState<ActiveEditor[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string>('owner')
  const lastUpdateTimestamp = useRef<string | null>(null)
  const pollingInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Track if initial load is complete
  const initialLoadComplete = useRef(false)

  const fetchTrip = useCallback(async (tripId: string) => {
    try {
      const res = await fetch(`/api/trips/${tripId}`)
      if (!res.ok) {
        setError('旅程が見つかりませんでした')
        setLoading(false)
        return
      }
      const data = (await res.json()) as { trip: Trip }
      setTrip(data.trip)
      // Only set form values on initial load
      if (!initialLoadComplete.current) {
        setEditTripTitle(data.trip.title)
        setEditTripStartDate(data.trip.startDate || '')
        setEditTripEndDate(data.trip.endDate || '')
        setEditTripTheme(data.trip.theme || 'quiet')
        setEditTripBudget(data.trip.budget?.toString() || '')
        initialLoadComplete.current = true
      }
    } catch (err) {
      console.error('Failed to fetch trip:', err)
      setError('旅程の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch trip members
  const fetchMembers = useCallback(async (tripId: string) => {
    try {
      const res = await fetch(`/api/trips/${tripId}/members`)
      if (res.ok) {
        const data = await res.json() as { members: TripMember[] }
        setTripMembers(data.members || [])
      }
    } catch (err) {
      console.error('Failed to fetch members:', err)
    }
  }, [])

  useEffect(() => {
    if (id) {
      fetchTrip(id)
      fetchMembers(id)
      // Fetch template status
      fetch(`/api/trips/${id}/template`)
        .then(res => res.ok ? res.json() as Promise<{ isTemplate?: boolean; templateUses?: number }> : null)
        .then((data) => {
          if (data) {
            setIsTemplate(data.isTemplate || false)
            setTemplateUses(data.templateUses || 0)
          }
        })
        .catch(err => console.error('Failed to fetch template status:', err))
    }
  }, [id, fetchTrip, fetchMembers])

  // Polling for collaborative editing - check for updates every 5 seconds
  useEffect(() => {
    if (!id) return

    const tripId = id  // Capture id for use in nested function

    async function checkForUpdates() {
      try {
        const url = lastUpdateTimestamp.current
          ? `/api/trips/${tripId}/updates?since=${encodeURIComponent(lastUpdateTimestamp.current)}`
          : `/api/trips/${tripId}/updates`

        const res = await fetch(url)
        if (!res.ok) return

        const data = await res.json() as {
          hasUpdates: boolean
          updatedAt: string
          activeEditors: ActiveEditor[]
          currentUserRole: string
        }

        setActiveEditors(data.activeEditors)
        setCurrentUserRole(data.currentUserRole)

        // Update the trip data if there are updates (and we're not currently editing)
        if (data.hasUpdates && !editingItem) {
          // Fetch the latest trip data
          await fetchTrip(tripId)
        }

        lastUpdateTimestamp.current = data.updatedAt
      } catch (err) {
        console.error('Failed to check for updates:', err)
      }
    }

    // Initial check
    checkForUpdates()

    // Set up polling interval (5 seconds)
    pollingInterval.current = setInterval(checkForUpdates, 5000)

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current)
      }
    }
  }, [id, editingItem, fetchTrip])

  // Toggle template status
  async function toggleTemplate() {
    if (!trip) return

    setSavingTemplate(true)
    try {
      const res = await fetch(`/api/trips/${trip.id}/template`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTemplate: !isTemplate }),
      })
      if (res.ok) {
        setIsTemplate(!isTemplate)
      }
    } catch (err) {
      console.error('Failed to toggle template:', err)
    } finally {
      setSavingTemplate(false)
    }
  }

  async function refreshTrip() {
    if (id) {
      setLoading(false) // Don't show loading on refresh
      await fetchTrip(id)
    }
  }

  // Auto-save trip function
  const saveTrip = useCallback(async (title: string, startDate: string, endDate: string, theme: TripTheme, budget: string) => {
    if (!trip || !title.trim()) return

    setSaving(true)
    try {
      await fetch(`/api/trips/${trip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          theme,
          budget: budget ? parseInt(budget, 10) : null,
        }),
      })
      setLastSaved(new Date())
      // Update local trip state
      setTrip(prev => prev ? {
        ...prev,
        title: title.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
        theme,
        budget: budget ? parseInt(budget, 10) : null,
      } : null)
    } catch (err) {
      console.error('Failed to save trip:', err)
    } finally {
      setSaving(false)
    }
  }, [trip])

  // Debounced save (500ms delay as per design spec)
  const debouncedSaveTrip = useDebounce(saveTrip, 500)

  // Auto-save when trip fields change
  useEffect(() => {
    // Don't auto-save until initial load is complete
    if (!initialLoadComplete.current || !trip) return

    // Don't save if values match the trip
    if (
      editTripTitle === trip.title &&
      editTripStartDate === (trip.startDate || '') &&
      editTripEndDate === (trip.endDate || '') &&
      editTripTheme === (trip.theme || 'quiet') &&
      editTripBudget === (trip.budget?.toString() || '')
    ) {
      return
    }

    debouncedSaveTrip(editTripTitle, editTripStartDate, editTripEndDate, editTripTheme, editTripBudget)
  }, [editTripTitle, editTripStartDate, editTripEndDate, editTripTheme, editTripBudget, debouncedSaveTrip, trip])

  // Delete trip
  async function deleteTrip() {
    if (!trip) return
    if (!confirm('この旅程を削除しますか？')) return

    try {
      await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
      navigate('/')
    } catch (err) {
      console.error('Failed to delete trip:', err)
    }
  }

  async function duplicateTrip() {
    if (!trip) return
    if (!confirm('この旅程を複製しますか？')) return

    try {
      const res = await fetch(`/api/trips/${trip.id}/duplicate`, { method: 'POST' })
      const data = (await res.json()) as { tripId?: string; error?: string }
      if (!res.ok) {
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

  // Create new day
  async function createDay(e: React.FormEvent) {
    e.preventDefault()
    if (!trip || !newDayDate) return

    setCreatingDay(true)
    try {
      const res = await fetch(`/api/trips/${trip.id}/days`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDayDate }),
      })
      const data = (await res.json()) as { day: Day }
      if (data.day) {
        setNewDayDate('')
        setShowDayForm(false)
        await refreshTrip()
      }
    } catch (err) {
      console.error('Failed to create day:', err)
    } finally {
      setCreatingDay(false)
    }
  }

  // Create multiple days at once
  async function createBulkDays(e: React.FormEvent) {
    e.preventDefault()
    if (!trip || !bulkStartDate || !bulkEndDate) return

    // Validate dates
    const start = new Date(bulkStartDate)
    const end = new Date(bulkEndDate)
    if (start > end) {
      alert('開始日は終了日以前にしてください')
      return
    }

    const dayCount = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    if (dayCount > 30) {
      alert('一度に追加できる日数は30日までです')
      return
    }

    setCreatingDay(true)
    try {
      const res = await fetch(`/api/trips/${trip.id}/days/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: bulkStartDate, endDate: bulkEndDate }),
      })
      const data = (await res.json()) as { days?: Day[]; skipped?: number; error?: string }
      if (data.error && !data.days) {
        alert(data.error)
        return
      }
      if (data.days && data.days.length > 0) {
        const skippedMsg = data.skipped && data.skipped > 0 ? `（${data.skipped}日は既存のためスキップ）` : ''
        showSuccess(`${data.days.length}日分の日程を追加しました${skippedMsg}`)
        setBulkStartDate('')
        setBulkEndDate('')
        setBulkDayMode(false)
        setShowDayForm(false)
        await refreshTrip()
      } else if (data.skipped && data.skipped > 0) {
        alert('追加する日程がありません（すべて既存の日程です）')
      }
    } catch (err) {
      console.error('Failed to create bulk days:', err)
      alert('日程の追加に失敗しました')
    } finally {
      setCreatingDay(false)
    }
  }

  // Delete day
  async function deleteDay(dayId: string) {
    if (!trip) return
    if (!confirm('この日程を削除しますか？関連する予定も削除されます。')) return

    try {
      await fetch(`/api/trips/${trip.id}/days/${dayId}`, { method: 'DELETE' })
      await refreshTrip()
    } catch (err) {
      console.error('Failed to delete day:', err)
    }
  }

  // Create new item
  async function createItem(e: React.FormEvent, dayId: string) {
    e.preventDefault()
    if (!trip || !newItemTitle.trim()) return

    setCreatingItem(true)
    try {
      // Auto-generate map URL if not provided
      const mapUrl = newItemMapUrl || generateMapUrl(newItemTitle.trim(), newItemArea || undefined)

      const res = await fetch(`/api/trips/${trip.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayId,
          title: newItemTitle.trim(),
          timeStart: newItemTime || undefined,
          area: newItemArea || undefined,
          note: newItemNote || undefined,
          cost: newItemCost ? parseInt(newItemCost, 10) : undefined,
          costCategory: newItemCostCategory || undefined,
          mapUrl,
        }),
      })
      const data = (await res.json()) as { item: Item }
      if (data.item) {
        setNewItemTitle('')
        setNewItemTime('')
        setNewItemArea('')
        setNewItemNote('')
        setNewItemCost('')
        setNewItemCostCategory('')
        setNewItemMapUrl('')
        setShowItemFormForDay(null)
        await refreshTrip()
      }
    } catch (err) {
      console.error('Failed to create item:', err)
    } finally {
      setCreatingItem(false)
    }
  }

  // Start editing item
  function startEditItem(item: Item) {
    setEditingItem(item)
    setEditItemTitle(item.title)
    setEditItemTime(item.timeStart || '')
    setEditItemArea(item.area || '')
    setEditItemNote(item.note || '')
    setEditItemCost(item.cost?.toString() || '')
    setEditItemCostCategory(item.costCategory || '')
    setEditItemMapUrl(item.mapUrl || '')
  }

  // Update item
  async function updateItem(e: React.FormEvent) {
    e.preventDefault()
    if (!trip || !editingItem || !editItemTitle.trim()) return

    setSavingItem(true)
    try {
      // Auto-generate map URL if not provided
      const mapUrl = editItemMapUrl || generateMapUrl(editItemTitle.trim(), editItemArea || undefined)

      const res = await fetch(`/api/trips/${trip.id}/items/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editItemTitle.trim(),
          timeStart: editItemTime || undefined,
          area: editItemArea || undefined,
          note: editItemNote || undefined,
          cost: editItemCost ? parseInt(editItemCost, 10) : undefined,
          costCategory: editItemCostCategory || null,
          mapUrl,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error || '更新に失敗しました')
      }
      setEditingItem(null)
      await refreshTrip()
    } catch (err) {
      console.error('Failed to update item:', err)
      showError(err instanceof Error ? err.message : '予定の更新に失敗しました')
    } finally {
      setSavingItem(false)
    }
  }

  // Delete item
  async function deleteItem(itemId: string) {
    if (!trip) return
    if (!confirm('この予定を削除しますか？')) return

    try {
      await fetch(`/api/trips/${trip.id}/items/${itemId}`, { method: 'DELETE' })
      await refreshTrip()
    } catch (err) {
      console.error('Failed to delete item:', err)
    }
  }

  // Auto-generate days from trip date range
  async function generateDays() {
    if (!trip || !editTripStartDate || !editTripEndDate) return

    const existingDates = new Set((trip.days || []).map(d => d.date))
    const start = new Date(editTripStartDate)
    const end = new Date(editTripEndDate)

    const daysToAdd: string[] = []
    const current = new Date(start)
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0]
      if (!existingDates.has(dateStr)) {
        daysToAdd.push(dateStr)
      }
      current.setDate(current.getDate() + 1)
    }

    if (daysToAdd.length === 0) {
      alert('追加する日程がありません')
      return
    }

    if (!confirm(`${daysToAdd.length}日分の日程を自動生成しますか？`)) return

    setGeneratingDays(true)
    try {
      for (const date of daysToAdd) {
        await fetch(`/api/trips/${trip.id}/days`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date }),
        })
      }
      await refreshTrip()
    } catch (err) {
      console.error('Failed to generate days:', err)
    } finally {
      setGeneratingDays(false)
    }
  }

  function getItemsForDay(dayId: string): Item[] {
    return (trip?.items || [])
      .filter((item) => item.dayId === dayId)
      .sort((a, b) => a.sort - b.sort)
  }

  // HTML5 Drag and Drop handlers
  function handleDragStart(e: React.DragEvent, itemId: string, dayId: string) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId, dayId }))
    setDraggedItem({ itemId, dayId })
  }

  function handleDragOver(e: React.DragEvent, itemId: string, dayId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverItem({ itemId, dayId })
  }

  function handleDragOverDay(e: React.DragEvent, dayId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDay(dayId)
  }

  function handleDragEnd() {
    setDraggedItem(null)
    setDragOverItem(null)
    setDragOverDay(null)
  }

  // Handle drop on an item (reorder within same day or move to different day)
  async function handleDrop(e: React.DragEvent, targetItemId: string, targetDayId: string) {
    e.preventDefault()
    if (!trip || !draggedItem) return

    const { itemId: sourceItemId, dayId: sourceDayId } = draggedItem

    // Reset drag state
    setDraggedItem(null)
    setDragOverItem(null)
    setDragOverDay(null)

    if (sourceItemId === targetItemId) return

    // Get items for target day
    const targetDayItems = getItemsForDay(targetDayId)
    const targetIndex = targetDayItems.findIndex((item) => item.id === targetItemId)

    if (sourceDayId === targetDayId) {
      // Same day reorder
      const sourceDayItems = getItemsForDay(sourceDayId)
      const sourceIndex = sourceDayItems.findIndex((item) => item.id === sourceItemId)

      if (sourceIndex === -1 || targetIndex === -1) return

      // Reorder items
      const reorderedItems = [...sourceDayItems]
      const [movedItem] = reorderedItems.splice(sourceIndex, 1)
      reorderedItems.splice(targetIndex, 0, movedItem)

      // Update local state optimistically
      setTrip((prev) => {
        if (!prev) return null
        const otherItems = prev.items?.filter((item) => item.dayId !== sourceDayId) || []
        const updatedDayItems = reorderedItems.map((item, index) => ({
          ...item,
          sort: index,
        }))
        return {
          ...prev,
          items: [...otherItems, ...updatedDayItems],
        }
      })

      // Save to server (same day)
      try {
        const newItemIds = reorderedItems.map((item) => item.id)
        await fetch(`/api/trips/${trip.id}/days/${sourceDayId}/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: newItemIds }),
        })
      } catch (err) {
        console.error('Failed to reorder items:', err)
        await refreshTrip()
      }
    } else {
      // Move to different day
      const newSort = targetIndex >= 0 ? targetIndex : targetDayItems.length

      // Update local state optimistically
      setTrip((prev) => {
        if (!prev) return null
        const updatedItems = prev.items?.map((item) => {
          if (item.id === sourceItemId) {
            return { ...item, dayId: targetDayId, sort: newSort }
          }
          return item
        }) || []
        return { ...prev, items: updatedItems }
      })

      // Save to server (cross-day move)
      try {
        await fetch(`/api/trips/${trip.id}/items/${sourceItemId}/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newDayId: targetDayId, newSort }),
        })
        // Refresh to get correct sort values after move
        await refreshTrip()
      } catch (err) {
        console.error('Failed to move item:', err)
        await refreshTrip()
      }
    }
  }

  // Handle drop on a day (move to end of that day)
  async function handleDropOnDay(e: React.DragEvent, targetDayId: string) {
    e.preventDefault()
    if (!trip || !draggedItem) return

    const { itemId: sourceItemId, dayId: sourceDayId } = draggedItem

    // Reset drag state
    setDraggedItem(null)
    setDragOverItem(null)
    setDragOverDay(null)

    if (sourceDayId === targetDayId) return

    const targetDayItems = getItemsForDay(targetDayId)
    const newSort = targetDayItems.length

    // Update local state optimistically
    setTrip((prev) => {
      if (!prev) return null
      const updatedItems = prev.items?.map((item) => {
        if (item.id === sourceItemId) {
          return { ...item, dayId: targetDayId, sort: newSort }
        }
        return item
      }) || []
      return { ...prev, items: updatedItems }
    })

    // Save to server
    try {
      await fetch(`/api/trips/${trip.id}/items/${sourceItemId}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDayId: targetDayId, newSort }),
      })
      await refreshTrip()
    } catch (err) {
      console.error('Failed to move item:', err)
      await refreshTrip()
    }
  }

  function getTotalCost(): number {
    return (trip?.items || []).reduce((sum, item) => sum + (item.cost || 0), 0)
  }

  // Upload cover image
  async function uploadCoverImage(file: File) {
    if (!trip) return

    if (!file.type.startsWith('image/')) {
      alert('画像ファイルを選択してください')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('ファイルサイズは5MB以下にしてください')
      return
    }

    setUploadingCover(true)
    try {
      const res = await fetch(`/api/trips/${trip.id}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })

      if (!res.ok) {
        throw new Error('Upload failed')
      }

      const data = (await res.json()) as { coverImageUrl: string }
      setTrip(prev => prev ? { ...prev, coverImageUrl: data.coverImageUrl } : null)
    } catch (err) {
      console.error('Failed to upload cover:', err)
      alert('画像のアップロードに失敗しました')
    } finally {
      setUploadingCover(false)
    }
  }

  // Delete cover image
  async function deleteCoverImage() {
    if (!trip) return
    if (!confirm('カバー画像を削除しますか？')) return

    try {
      await fetch(`/api/trips/${trip.id}/cover`, { method: 'DELETE' })
      setTrip(prev => prev ? { ...prev, coverImageUrl: null } : null)
    } catch (err) {
      console.error('Failed to delete cover:', err)
    }
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
      <div className="hero print-hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
        <div className="edit-trip-form no-print">
          <input
            type="text"
            value={editTripTitle}
            onChange={(e) => setEditTripTitle(e.target.value)}
            className="input hero-title-input"
            placeholder="旅程のタイトル"
          />
          <div className="date-inputs">
            <DatePicker
              value={editTripStartDate}
              onChange={setEditTripStartDate}
              placeholder="開始日"
              max={editTripEndDate || undefined}
            />
            <span className="date-separator">〜</span>
            <DatePicker
              value={editTripEndDate}
              onChange={setEditTripEndDate}
              placeholder="終了日"
              min={editTripStartDate || undefined}
            />
          </div>
          {/* Theme selector */}
          <div className="theme-selector">
            <button
              type="button"
              className={`theme-btn ${editTripTheme === 'quiet' ? 'active' : ''}`}
              onClick={() => setEditTripTheme('quiet')}
            >
              しずか
            </button>
            <button
              type="button"
              className={`theme-btn ${editTripTheme === 'photo' ? 'active' : ''}`}
              onClick={() => setEditTripTheme('photo')}
            >
              写真映え
            </button>
          </div>
          {/* Budget input */}
          <div className="budget-input-section">
            <input
              type="number"
              value={editTripBudget}
              onChange={(e) => setEditTripBudget(e.target.value)}
              className="input"
              placeholder="予算（円）"
              min="0"
              step="1000"
            />
          </div>
          {/* Cover image */}
          <div className="cover-section">
            {trip.coverImageUrl ? (
              <div className="cover-preview">
                <img src={trip.coverImageUrl} alt="カバー画像" className="cover-image" />
                <button
                  type="button"
                  className="btn-text btn-small btn-danger"
                  onClick={deleteCoverImage}
                >
                  削除
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-outline cover-upload-btn"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
              >
                {uploadingCover ? 'アップロード中...' : 'カバー画像を追加'}
              </button>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadCoverImage(file)
                e.target.value = ''
              }}
            />
          </div>
          {/* Template toggle */}
          <div className="template-toggle-section">
            <label className="template-toggle">
              <input
                type="checkbox"
                checked={isTemplate}
                onChange={toggleTemplate}
                disabled={savingTemplate}
              />
              <span className="template-toggle-label">
                テンプレートとして公開
              </span>
            </label>
            {isTemplate && (
              <span className="template-uses-badge">
                {templateUses}回使用
              </span>
            )}
          </div>
          {/* Auto-save indicator */}
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-faint)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
            {saving ? '保存中...' : lastSaved ? `保存済み ${lastSaved.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        </div>
        {editTripStartDate && editTripEndDate && (
          <p className="hero-subtitle" style={{ marginTop: 'var(--space-3)' }}>
            {formatDateRange(editTripStartDate, editTripEndDate)}
          </p>
        )}
        <div className="hero-actions-row no-print" style={{ marginTop: 'var(--space-3)' }}>
          <Link to={`/trips/${trip.id}`} className="btn-text">プレビュー</Link>
          <button className="btn-text" onClick={duplicateTrip}>複製</button>
          <button className="btn-text" onClick={() => setShowReminderModal(true)}>リマインダー</button>
          {currentUserRole === 'owner' && (
            <button className="btn-text" onClick={() => setShowCollaboratorModal(true)}>共同編集者</button>
          )}
          <button className="btn-text btn-danger" onClick={deleteTrip}>削除</button>
        </div>

        {/* Active editors indicator */}
        {activeEditors.length > 0 && (
          <div className="active-editors no-print">
            <span className="active-editors-label">編集中:</span>
            {activeEditors.map((editor) => (
              <span key={editor.userId} className="active-editor">
                {editor.avatarUrl && (
                  <img src={editor.avatarUrl} alt="" className="active-editor-avatar" />
                )}
                <span className="active-editor-name">{editor.userName || '匿名'}</span>
              </span>
            ))}
          </div>
        )}

        {/* Role indicator for collaborators */}
        {currentUserRole !== 'owner' && (
          <div className="collaborator-role-badge no-print">
            {currentUserRole === 'editor' ? '編集者として参加中' : '閲覧者として参加中'}
          </div>
        )}
      </div>

      {(!trip.days || trip.days.length === 0) ? (
        <div className="empty-state">
          <p className="empty-state-text">
            日程がまだありません。
          </p>
          {editTripStartDate && editTripEndDate && (
            <button
              className="btn-outline no-print"
              onClick={generateDays}
              disabled={generatingDays}
              style={{ marginTop: 'var(--space-4)' }}
            >
              {generatingDays ? '生成中...' : '日程を自動生成'}
            </button>
          )}
        </div>
      ) : (
        trip.days
          .sort((a, b) => a.sort - b.sort)
          .map((day, index) => {
            const { label, dateStr } = formatDayLabel(day.date, index)
            const items = getItemsForDay(day.id)
            return (
              <div
                key={day.id}
                className={`day-section ${dragOverDay === day.id ? 'day-drop-zone-active' : ''}`}
                onDragOver={(e) => handleDragOverDay(e, day.id)}
                onDrop={(e) => handleDropOnDay(e, day.id)}
              >
                <div className="day-header">
                  <span className="day-label">{label}</span>
                  <span className="day-date">{dateStr}</span>
                  <button
                    className="btn-text btn-small btn-danger no-print"
                    onClick={() => deleteDay(day.id)}
                  >
                    削除
                  </button>
                </div>
                {items.length === 0 ? (
                  <div
                    className={`empty-day-drop-zone ${dragOverDay === day.id && draggedItem?.dayId !== day.id ? 'drop-zone-highlight' : ''}`}
                    onDragOver={(e) => handleDragOverDay(e, day.id)}
                    onDrop={(e) => handleDropOnDay(e, day.id)}
                  >
                    <span className="timeline-time">—</span>
                    <div className="timeline-content">
                      <span className="timeline-title" style={{ color: 'var(--color-text-faint)' }}>
                        {draggedItem && draggedItem.dayId !== day.id
                          ? 'ここにドロップして移動'
                          : '予定がありません'}
                      </span>
                    </div>
                  </div>
                ) : (
                  items.map((item) => (
                    <DraggableItem
                      key={item.id}
                      item={item}
                      dayId={day.id}
                      tripId={trip.id}
                      editingItem={editingItem}
                      onStartEdit={startEditItem}
                      onDelete={deleteItem}
                      editItemTime={editItemTime}
                      setEditItemTime={setEditItemTime}
                      editItemTitle={editItemTitle}
                      setEditItemTitle={setEditItemTitle}
                      editItemArea={editItemArea}
                      setEditItemArea={setEditItemArea}
                      editItemCost={editItemCost}
                      setEditItemCost={setEditItemCost}
                      editItemCostCategory={editItemCostCategory}
                      setEditItemCostCategory={setEditItemCostCategory}
                      editItemNote={editItemNote}
                      setEditItemNote={setEditItemNote}
                      editItemMapUrl={editItemMapUrl}
                      setEditItemMapUrl={setEditItemMapUrl}
                      savingItem={savingItem}
                      onCancelEdit={() => setEditingItem(null)}
                      onSubmitEdit={updateItem}
                      onPhotoUploaded={refreshTrip}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      onDrop={handleDrop}
                      isDragging={draggedItem?.itemId === item.id}
                      isDragOver={dragOverItem?.itemId === item.id && draggedItem?.itemId !== item.id}
                    />
                  ))
                )}

                {/* Add item form */}
                {showItemFormForDay === day.id ? (
                  <form className="inline-form no-print" onSubmit={(e) => createItem(e, day.id)}>
                    <input
                      type="text"
                      placeholder="予定のタイトル"
                      value={newItemTitle}
                      onChange={(e) => setNewItemTitle(e.target.value)}
                      className="input"
                      autoFocus
                    />
                    <div className="form-row">
                      <TimePicker
                        value={newItemTime}
                        onChange={setNewItemTime}
                        placeholder="時刻"
                        className="input-small"
                      />
                      <input
                        type="text"
                        placeholder="エリア"
                        value={newItemArea}
                        onChange={(e) => setNewItemArea(e.target.value)}
                        className="input"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="メモ"
                      value={newItemNote}
                      onChange={(e) => setNewItemNote(e.target.value)}
                      className="input"
                    />
                    <input
                      type="url"
                      placeholder="地図URL（Google Maps等）"
                      value={newItemMapUrl}
                      onChange={(e) => setNewItemMapUrl(e.target.value)}
                      className="input"
                    />
                    <div className="form-row">
                      <input
                        type="number"
                        placeholder="費用（円）"
                        value={newItemCost}
                        onChange={(e) => setNewItemCost(e.target.value)}
                        className="input input-small"
                      />
                      <select
                        value={newItemCostCategory}
                        onChange={(e) => setNewItemCostCategory(e.target.value as CostCategory | '')}
                        className="input"
                      >
                        <option value="">カテゴリ</option>
                        {COST_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => setShowItemFormForDay(null)}
                      >
                        キャンセル
                      </button>
                      <button
                        type="submit"
                        className="btn-filled"
                        disabled={creatingItem || !newItemTitle.trim()}
                      >
                        {creatingItem ? '追加中...' : '追加'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className="btn-text add-item-btn no-print"
                    onClick={() => setShowItemFormForDay(day.id)}
                  >
                    + 予定を追加
                  </button>
                )}

                {/* その他 section */}
                <DayNotesSection
                  day={day}
                  tripId={trip.id}
                  onUpdated={refreshTrip}
                />
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

      {/* Expense Splitting Section */}
      <div className="expense-section-wrapper no-print">
        <button
          type="button"
          className="btn-outline expense-toggle-btn"
          onClick={() => setShowMemberManager(!showMemberManager)}
        >
          {showMemberManager ? '− 費用分割を閉じる' : '+ 費用分割・精算'}
        </button>

        {showMemberManager && trip && (
          <div className="expense-management">
            <TripMemberManager
              tripId={trip.id}
              members={tripMembers}
              onMembersChange={() => fetchMembers(trip.id)}
            />
            <SettlementSummary tripId={trip.id} />
          </div>
        )}

        {/* Packing List */}
        {trip && <PackingList tripId={trip.id} />}
      </div>

      {/* Add day form */}
      <div className="add-day-section no-print">
        {showDayForm ? (
          <form className="inline-form" onSubmit={bulkDayMode ? createBulkDays : createDay}>
            <div className="bulk-mode-toggle">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={bulkDayMode}
                  onChange={(e) => {
                    setBulkDayMode(e.target.checked)
                    if (!e.target.checked) {
                      setBulkStartDate('')
                      setBulkEndDate('')
                    } else {
                      setNewDayDate('')
                    }
                  }}
                />
                <span>複数日を追加</span>
              </label>
            </div>
            {bulkDayMode ? (
              <div className="form-row bulk-date-row">
                <div className="date-range-inputs">
                  <DatePicker
                    value={bulkStartDate}
                    onChange={setBulkStartDate}
                    placeholder="開始日"
                    min={editTripStartDate || undefined}
                    max={editTripEndDate || undefined}
                  />
                  <span className="date-separator">〜</span>
                  <DatePicker
                    value={bulkEndDate}
                    onChange={setBulkEndDate}
                    placeholder="終了日"
                    min={bulkStartDate || editTripStartDate || undefined}
                    max={editTripEndDate || undefined}
                  />
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => {
                      setShowDayForm(false)
                      setBulkDayMode(false)
                      setBulkStartDate('')
                      setBulkEndDate('')
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="btn-filled"
                    disabled={creatingDay || !bulkStartDate || !bulkEndDate}
                  >
                    {creatingDay ? '追加中...' : '一括追加'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-row">
                <DatePicker
                  value={newDayDate}
                  onChange={setNewDayDate}
                  placeholder="日付を選択"
                  min={editTripStartDate || undefined}
                  max={editTripEndDate || undefined}
                />
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => {
                      setShowDayForm(false)
                      setBulkDayMode(false)
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="btn-filled"
                    disabled={creatingDay || !newDayDate}
                  >
                    {creatingDay ? '追加中...' : '追加'}
                  </button>
                </div>
              </div>
            )}
          </form>
        ) : (
          <div className="add-day-buttons">
            <button
              className="btn-outline"
              onClick={() => setShowDayForm(true)}
            >
              + 日程を追加
            </button>
            {editTripStartDate && editTripEndDate && (
              <button
                className="btn-text"
                onClick={generateDays}
                disabled={generatingDays}
              >
                {generatingDays ? '生成中...' : '日程を自動生成'}
              </button>
            )}
          </div>
        )}
      </div>

      <button
        className="btn-text back-btn no-print"
        onClick={() => navigate('/')}
      >
        ← 旅程一覧に戻る
      </button>

      {/* Reminder settings modal */}
      {showReminderModal && (
        <ReminderSettings
          trip={trip}
          onClose={() => setShowReminderModal(false)}
        />
      )}

      {showCollaboratorModal && (
        <CollaboratorManager
          tripId={trip.id}
          onClose={() => setShowCollaboratorModal(false)}
        />
      )}
    </>
  )
}
