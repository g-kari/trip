import { useState, useEffect } from 'react'
import './App.css'
import { MarkdownText } from './components/MarkdownText'
import { DatePicker } from './components/DatePicker'

// API response types
type Trip = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  createdAt: string
  days?: Day[]
  items?: Item[]
}

type Day = {
  id: string
  date: string
  sort: number
}

type Item = {
  id: string
  dayId: string
  title: string
  area: string | null
  timeStart: string | null
  timeEnd: string | null
  mapUrl: string | null
  note: string | null
  cost: number | null
  sort: number
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(s)} – ${fmt(e)}`
}

function formatCost(cost: number): string {
  return `¥${cost.toLocaleString()}`
}

function formatDayLabel(date: string, index: number): { label: string; dateStr: string } {
  const d = new Date(date)
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const dayOfWeek = days[d.getDay()]
  return {
    label: `Day ${index + 1}`,
    dateStr: `${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`,
  }
}

// Check if we're viewing a shared trip
function getShareToken(): string | null {
  const path = window.location.pathname
  const match = path.match(/^\/s\/([a-zA-Z0-9]+)$/)
  return match ? match[1] : null
}

function App() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTripTitle, setNewTripTitle] = useState('')
  const [newTripStartDate, setNewTripStartDate] = useState('')
  const [newTripEndDate, setNewTripEndDate] = useState('')
  const [creating, setCreating] = useState(false)

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

  // Edit trip state
  const [editingTrip, setEditingTrip] = useState(false)
  const [editTripTitle, setEditTripTitle] = useState('')
  const [editTripStartDate, setEditTripStartDate] = useState('')
  const [editTripEndDate, setEditTripEndDate] = useState('')
  const [savingTrip, setSavingTrip] = useState(false)

  // Share state
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [isSharedView, setIsSharedView] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  // Check for shared view on mount
  useEffect(() => {
    const token = getShareToken()
    if (token) {
      setIsSharedView(true)
      fetchSharedTrip(token)
    } else {
      fetchTrips()
    }
  }, [])

  // Fetch shared trip
  async function fetchSharedTrip(token: string) {
    try {
      const res = await fetch(`/api/shared/${token}`)
      if (!res.ok) {
        setShareError('この共有リンクは無効です')
        setLoading(false)
        return
      }
      const data = (await res.json()) as { trip: Trip }
      setSelectedTrip(data.trip)
    } catch (err) {
      console.error('Failed to fetch shared trip:', err)
      setShareError('旅程の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // Fetch trips list
  async function fetchTrips() {
    try {
      const res = await fetch('/api/trips')
      const data = (await res.json()) as { trips: Trip[] }
      setTrips(data.trips || [])
    } catch (err) {
      console.error('Failed to fetch trips:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch single trip with details
  async function selectTrip(tripId: string) {
    try {
      const res = await fetch(`/api/trips/${tripId}`)
      const data = (await res.json()) as { trip: Trip }
      setSelectedTrip(data.trip)
      // Fetch share token
      const shareRes = await fetch(`/api/trips/${tripId}/share`)
      const shareData = (await shareRes.json()) as { token: string | null }
      setShareToken(shareData.token)
    } catch (err) {
      console.error('Failed to fetch trip:', err)
    }
  }

  // Refresh selected trip
  async function refreshTrip() {
    if (selectedTrip) {
      await selectTrip(selectedTrip.id)
    }
  }

  // Create new trip
  async function createTrip(e: React.FormEvent) {
    e.preventDefault()
    if (!newTripTitle.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTripTitle.trim(),
          startDate: newTripStartDate || undefined,
          endDate: newTripEndDate || undefined,
        }),
      })
      const data = (await res.json()) as { trip: Trip }
      if (data.trip) {
        setTrips((prev) => [data.trip, ...prev])
        setNewTripTitle('')
        setNewTripStartDate('')
        setNewTripEndDate('')
        setShowCreateForm(false)
        selectTrip(data.trip.id)
      }
    } catch (err) {
      console.error('Failed to create trip:', err)
    } finally {
      setCreating(false)
    }
  }

  // Update trip
  async function updateTrip(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTrip || !editTripTitle.trim()) return

    setSavingTrip(true)
    try {
      const res = await fetch(`/api/trips/${selectedTrip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTripTitle.trim(),
          startDate: editTripStartDate || undefined,
          endDate: editTripEndDate || undefined,
        }),
      })
      const data = (await res.json()) as { trip: Trip }
      if (data.trip) {
        setTrips((prev) => prev.map((t) => (t.id === data.trip.id ? { ...t, ...data.trip } : t)))
        setEditingTrip(false)
        await refreshTrip()
      }
    } catch (err) {
      console.error('Failed to update trip:', err)
    } finally {
      setSavingTrip(false)
    }
  }

  // Delete trip
  async function deleteTrip() {
    if (!selectedTrip) return
    if (!confirm('この旅程を削除しますか？')) return

    try {
      await fetch(`/api/trips/${selectedTrip.id}`, { method: 'DELETE' })
      setTrips((prev) => prev.filter((t) => t.id !== selectedTrip.id))
      setSelectedTrip(null)
    } catch (err) {
      console.error('Failed to delete trip:', err)
    }
  }

  // Start editing trip
  function startEditTrip() {
    if (!selectedTrip) return
    setEditTripTitle(selectedTrip.title)
    setEditTripStartDate(selectedTrip.startDate || '')
    setEditTripEndDate(selectedTrip.endDate || '')
    setEditingTrip(true)
  }

  // Create new day
  async function createDay(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTrip || !newDayDate) return

    setCreatingDay(true)
    try {
      const res = await fetch(`/api/trips/${selectedTrip.id}/days`, {
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
    if (!selectedTrip) return
    if (!confirm('この日程を削除しますか？関連する予定も削除されます。')) return

    try {
      await fetch(`/api/trips/${selectedTrip.id}/days/${dayId}`, { method: 'DELETE' })
      await refreshTrip()
    } catch (err) {
      console.error('Failed to delete day:', err)
    }
  }

  // Create new item
  async function createItem(e: React.FormEvent, dayId: string) {
    e.preventDefault()
    if (!selectedTrip || !newItemTitle.trim()) return

    setCreatingItem(true)
    try {
      const res = await fetch(`/api/trips/${selectedTrip.id}/items`, {
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
    if (!selectedTrip || !editingItem || !editItemTitle.trim()) return

    setSavingItem(true)
    try {
      await fetch(`/api/trips/${selectedTrip.id}/items/${editingItem.id}`, {
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
    if (!selectedTrip) return
    if (!confirm('この予定を削除しますか？')) return

    try {
      await fetch(`/api/trips/${selectedTrip.id}/items/${itemId}`, { method: 'DELETE' })
      await refreshTrip()
    } catch (err) {
      console.error('Failed to delete item:', err)
    }
  }

  // Auto-generate days from trip date range
  async function generateDays() {
    if (!selectedTrip || !selectedTrip.startDate || !selectedTrip.endDate) return

    const existingDates = new Set((selectedTrip.days || []).map(d => d.date))
    const start = new Date(selectedTrip.startDate)
    const end = new Date(selectedTrip.endDate)

    // Calculate days to add
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
      // Create days sequentially
      for (const date of daysToAdd) {
        await fetch(`/api/trips/${selectedTrip.id}/days`, {
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

  // Create share link
  async function createShareLink() {
    if (!selectedTrip) return

    try {
      const res = await fetch(`/api/trips/${selectedTrip.id}/share`, { method: 'POST' })
      const data = (await res.json()) as { token: string }
      setShareToken(data.token)
      setShowShareModal(true)
    } catch (err) {
      console.error('Failed to create share link:', err)
    }
  }

  // Delete share link
  async function deleteShareLink() {
    if (!selectedTrip) return
    if (!confirm('共有リンクを削除しますか？')) return

    try {
      await fetch(`/api/trips/${selectedTrip.id}/share`, { method: 'DELETE' })
      setShareToken(null)
      setShowShareModal(false)
    } catch (err) {
      console.error('Failed to delete share link:', err)
    }
  }

  // Copy share link
  function copyShareLink() {
    if (!shareToken) return
    const url = `${window.location.origin}/s/${shareToken}`
    navigator.clipboard.writeText(url)
    alert('リンクをコピーしました')
  }

  // Print trip
  function printTrip() {
    window.print()
  }

  // Group items by day
  function getItemsForDay(dayId: string): Item[] {
    return (selectedTrip?.items || [])
      .filter((item) => item.dayId === dayId)
      .sort((a, b) => {
        if (a.timeStart && b.timeStart) return a.timeStart.localeCompare(b.timeStart)
        return a.sort - b.sort
      })
  }

  // Calculate total cost
  function getTotalCost(): number {
    return (selectedTrip?.items || []).reduce((sum, item) => sum + (item.cost || 0), 0)
  }

  if (loading) {
    return (
      <div className="app">
        <header className="header">
          <span className="header-logo">旅程</span>
        </header>
        <main className="main">
          <div className="empty-state">
            <p className="empty-state-text">読み込み中...</p>
          </div>
        </main>
      </div>
    )
  }

  // Shared view error
  if (isSharedView && shareError) {
    return (
      <div className="app">
        <header className="header">
          <span className="header-logo">旅程</span>
        </header>
        <main className="main">
          <div className="empty-state">
            <p className="empty-state-text">{shareError}</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header no-print">
        <span
          className="header-logo"
          onClick={() => {
            if (!isSharedView) {
              setSelectedTrip(null)
              window.history.pushState({}, '', '/')
            }
          }}
          style={{ cursor: isSharedView ? 'default' : 'pointer' }}
        >
          旅程
        </span>
      </header>

      <main className="main">
        {/* Trip detail: day timeline */}
        {selectedTrip && (
          <>
            <div className="hero print-hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
              {editingTrip && !isSharedView ? (
                <form className="edit-trip-form no-print" onSubmit={updateTrip}>
                  <input
                    type="text"
                    value={editTripTitle}
                    onChange={(e) => setEditTripTitle(e.target.value)}
                    className="input hero-title-input"
                    autoFocus
                  />
                  <div className="date-inputs">
                    <DatePicker
                      value={editTripStartDate}
                      onChange={setEditTripStartDate}
                      max={editTripEndDate}
                    />
                    <span className="date-separator">〜</span>
                    <DatePicker
                      value={editTripEndDate}
                      onChange={setEditTripEndDate}
                      min={editTripStartDate}
                    />
                  </div>
                  <div className="form-actions" style={{ justifyContent: 'center', marginTop: 'var(--space-3)' }}>
                    <button type="button" className="btn-text" onClick={() => setEditingTrip(false)}>
                      キャンセル
                    </button>
                    <button type="submit" className="btn-filled" disabled={savingTrip || !editTripTitle.trim()}>
                      {savingTrip ? '保存中...' : '保存'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <h1 className="hero-title">{selectedTrip.title}</h1>
                  {selectedTrip.startDate && selectedTrip.endDate && (
                    <p className="hero-subtitle">
                      {formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}
                    </p>
                  )}
                  {!isSharedView && (
                    <div className="hero-actions-row no-print">
                      <button className="btn-text" onClick={startEditTrip}>編集</button>
                      <button className="btn-text" onClick={createShareLink}>共有</button>
                      <button className="btn-text" onClick={printTrip}>印刷</button>
                      <button className="btn-text btn-danger" onClick={deleteTrip}>削除</button>
                    </div>
                  )}
                  {isSharedView && (
                    <div className="hero-actions-row no-print">
                      <button className="btn-text" onClick={printTrip}>印刷</button>
                    </div>
                  )}
                </>
              )}
            </div>

            {(!selectedTrip.days || selectedTrip.days.length === 0) ? (
              <div className="empty-state">
                <p className="empty-state-text">
                  日程がまだありません。
                </p>
                {!isSharedView && selectedTrip.startDate && selectedTrip.endDate && (
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
              selectedTrip.days
                .sort((a, b) => a.sort - b.sort)
                .map((day, index) => {
                  const { label, dateStr } = formatDayLabel(day.date, index)
                  const items = getItemsForDay(day.id)
                  return (
                    <div key={day.id} className="day-section">
                      <div className="day-header">
                        <span className="day-label">{label}</span>
                        <span className="day-date">{dateStr}</span>
                        {!isSharedView && (
                          <button
                            className="btn-text btn-small btn-danger no-print"
                            onClick={() => deleteDay(day.id)}
                          >
                            削除
                          </button>
                        )}
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
                            {editingItem?.id === item.id && !isSharedView ? (
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
                                    <p className="timeline-note">
                                      <MarkdownText text={item.note} />
                                    </p>
                                  )}
                                  {!isSharedView && (
                                    <div className="item-actions no-print">
                                      <button className="btn-text btn-small" onClick={() => startEditItem(item)}>
                                        編集
                                      </button>
                                      <button className="btn-text btn-small btn-danger" onClick={() => deleteItem(item.id)}>
                                        削除
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        ))
                      )}

                      {/* Add item form */}
                      {!isSharedView && showItemFormForDay === day.id ? (
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
                      ) : !isSharedView && (
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
            {!isSharedView && (
              <div className="add-day-section no-print">
                {showDayForm ? (
                  <form className="inline-form" onSubmit={createDay}>
                    <div className="form-row">
                      <DatePicker
                        value={newDayDate}
                        onChange={setNewDayDate}
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
                    {selectedTrip.startDate && selectedTrip.endDate && (
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
            )}

            {!isSharedView && (
              <button
                className="btn-text back-btn no-print"
                onClick={() => setSelectedTrip(null)}
              >
                ← 旅程一覧に戻る
              </button>
            )}
          </>
        )}

        {/* Trip list section */}
        {!selectedTrip && !isSharedView && (
          <div className="trip-list-section">
            <div className="section-header">
              <span className="section-title">trips</span>
              <button
                className="btn-outline"
                onClick={() => setShowCreateForm(!showCreateForm)}
              >
                {showCreateForm ? 'キャンセル' : 'あたらしい旅程'}
              </button>
            </div>

            {/* Create form */}
            {showCreateForm && (
              <form className="create-form" onSubmit={createTrip}>
                <input
                  type="text"
                  placeholder="旅程のタイトル"
                  value={newTripTitle}
                  onChange={(e) => setNewTripTitle(e.target.value)}
                  className="input"
                  autoFocus
                />
                <div className="date-inputs">
                  <DatePicker
                    value={newTripStartDate}
                    onChange={setNewTripStartDate}
                    max={newTripEndDate}
                  />
                  <span className="date-separator">〜</span>
                  <DatePicker
                    value={newTripEndDate}
                    onChange={setNewTripEndDate}
                    min={newTripStartDate}
                  />
                </div>
                <button
                  type="submit"
                  className="btn-filled"
                  disabled={creating || !newTripTitle.trim()}
                >
                  {creating ? '作成中...' : '作成する'}
                </button>
              </form>
            )}

            {trips.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">—</div>
                <p className="empty-state-text">
                  まだ旅程がありません。<br />
                  あたらしい旅程をつくりましょう。
                </p>
              </div>
            ) : (
              trips.map((trip) => (
                <div
                  key={trip.id}
                  className="trip-card"
                  onClick={() => selectTrip(trip.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="trip-card-title">{trip.title}</div>
                  {trip.startDate && trip.endDate && (
                    <div className="trip-card-date">
                      {formatDateRange(trip.startDate, trip.endDate)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>

      <footer className="footer no-print">
        <span className="footer-text">旅程</span>
      </footer>

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
    </div>
  )
}

export default App
