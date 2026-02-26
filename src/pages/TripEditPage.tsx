import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Trip, Day, Item, TripTheme } from '../types'
import { formatDateRange, formatCost, formatDayLabel } from '../utils'
import { useDebounce } from '../hooks/useDebounce'

export function TripEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Day form state
  const [showDayForm, setShowDayForm] = useState(false)
  const [newDayDate, setNewDayDate] = useState('')
  const [creatingDay, setCreatingDay] = useState(false)

  // Item form state
  const [showItemFormForDay, setShowItemFormForDay] = useState<string | null>(null)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemTime, setNewItemTime] = useState('')
  const [newItemArea, setNewItemArea] = useState('')
  const [newItemNote, setNewItemNote] = useState('')
  const [newItemCost, setNewItemCost] = useState('')
  const [newItemMapUrl, setNewItemMapUrl] = useState('')
  const [creatingItem, setCreatingItem] = useState(false)

  // Edit item state
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [editItemTitle, setEditItemTitle] = useState('')
  const [editItemTime, setEditItemTime] = useState('')
  const [editItemArea, setEditItemArea] = useState('')
  const [editItemNote, setEditItemNote] = useState('')
  const [editItemCost, setEditItemCost] = useState('')
  const [editItemMapUrl, setEditItemMapUrl] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  // Auto-generate days state
  const [generatingDays, setGeneratingDays] = useState(false)

  // Cover image state
  const [uploadingCover, setUploadingCover] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

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
        initialLoadComplete.current = true
      }
    } catch (err) {
      console.error('Failed to fetch trip:', err)
      setError('旅程の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) {
      fetchTrip(id)
    }
  }, [id, fetchTrip])

  async function refreshTrip() {
    if (id) {
      setLoading(false) // Don't show loading on refresh
      await fetchTrip(id)
    }
  }

  // Auto-save trip function
  const saveTrip = useCallback(async (title: string, startDate: string, endDate: string, theme: TripTheme) => {
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
      editTripTheme === (trip.theme || 'quiet')
    ) {
      return
    }

    debouncedSaveTrip(editTripTitle, editTripStartDate, editTripEndDate, editTripTheme)
  }, [editTripTitle, editTripStartDate, editTripEndDate, editTripTheme, debouncedSaveTrip, trip])

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
          mapUrl: newItemMapUrl || undefined,
        }),
      })
      const data = (await res.json()) as { item: Item }
      if (data.item) {
        setNewItemTitle('')
        setNewItemTime('')
        setNewItemArea('')
        setNewItemNote('')
        setNewItemCost('')
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
    setEditItemMapUrl(item.mapUrl || '')
  }

  // Update item
  async function updateItem(e: React.FormEvent) {
    e.preventDefault()
    if (!trip || !editingItem || !editItemTitle.trim()) return

    setSavingItem(true)
    try {
      await fetch(`/api/trips/${trip.id}/items/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editItemTitle.trim(),
          timeStart: editItemTime || undefined,
          area: editItemArea || undefined,
          note: editItemNote || undefined,
          cost: editItemCost ? parseInt(editItemCost, 10) : undefined,
          mapUrl: editItemMapUrl || undefined,
        }),
      })
      setEditingItem(null)
      await refreshTrip()
    } catch (err) {
      console.error('Failed to update item:', err)
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
      .sort((a, b) => {
        if (a.timeStart && b.timeStart) return a.timeStart.localeCompare(b.timeStart)
        return a.sort - b.sort
      })
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
            <input
              type="date"
              value={editTripStartDate}
              onChange={(e) => setEditTripStartDate(e.target.value)}
              className="input"
            />
            <span className="date-separator">〜</span>
            <input
              type="date"
              value={editTripEndDate}
              onChange={(e) => setEditTripEndDate(e.target.value)}
              className="input"
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
          <button className="btn-text btn-danger" onClick={deleteTrip}>削除</button>
        </div>
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
              <div key={day.id} className="day-section">
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
                      {editingItem?.id === item.id ? (
                        <form className="edit-item-form no-print" onSubmit={updateItem}>
                          <div className="form-row">
                            <input
                              type="time"
                              value={editItemTime}
                              onChange={(e) => setEditItemTime(e.target.value)}
                              className="input input-small"
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
                            <button type="button" className="btn-text" onClick={() => setEditingItem(null)}>
                              キャンセル
                            </button>
                            <button type="submit" className="btn-filled" disabled={savingItem || !editItemTitle.trim()}>
                              {savingItem ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
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
                            <div className="item-actions no-print">
                              <button className="btn-text btn-small" onClick={() => startEditItem(item)}>
                                編集
                              </button>
                              <button className="btn-text btn-small btn-danger" onClick={() => deleteItem(item.id)}>
                                削除
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
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
                      <input
                        type="time"
                        value={newItemTime}
                        onChange={(e) => setNewItemTime(e.target.value)}
                        className="input input-small"
                        placeholder="時刻"
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

      {/* Add day form */}
      <div className="add-day-section no-print">
        {showDayForm ? (
          <form className="inline-form" onSubmit={createDay}>
            <div className="form-row">
              <input
                type="date"
                value={newDayDate}
                onChange={(e) => setNewDayDate(e.target.value)}
                className="input"
                autoFocus
              />
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setShowDayForm(false)}
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
    </>
  )
}
