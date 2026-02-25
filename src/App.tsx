import { useState, useEffect } from 'react'
import './App.css'

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
  const [creatingItem, setCreatingItem] = useState(false)

  // Fetch trips list
  useEffect(() => {
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
    fetchTrips()
  }, [])

  // Fetch single trip with details
  async function selectTrip(tripId: string) {
    try {
      const res = await fetch(`/api/trips/${tripId}`)
      const data = (await res.json()) as { trip: Trip }
      setSelectedTrip(data.trip)
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
        }),
      })
      const data = (await res.json()) as { item: Item }
      if (data.item) {
        setNewItemTitle('')
        setNewItemTime('')
        setNewItemArea('')
        setNewItemNote('')
        setNewItemCost('')
        setShowItemFormForDay(null)
        await refreshTrip()
      }
    } catch (err) {
      console.error('Failed to create item:', err)
    } finally {
      setCreatingItem(false)
    }
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

  return (
    <div className="app">
      <header className="header">
        <span className="header-logo" onClick={() => setSelectedTrip(null)} style={{ cursor: 'pointer' }}>
          旅程
        </span>
      </header>

      <main className="main">
        {/* Trip detail: day timeline */}
        {selectedTrip && (
          <>
            <div className="hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
              <h1 className="hero-title">{selectedTrip.title}</h1>
              {selectedTrip.startDate && selectedTrip.endDate && (
                <p className="hero-subtitle">
                  {formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}
                </p>
              )}
            </div>

            {(!selectedTrip.days || selectedTrip.days.length === 0) ? (
              <div className="empty-state">
                <p className="empty-state-text">
                  日程がまだありません。
                </p>
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
                              </div>
                              {item.note && (
                                <p className="timeline-note">{item.note}</p>
                              )}
                            </div>
                          </div>
                        ))
                      )}

                      {/* Add item form */}
                      {showItemFormForDay === day.id ? (
                        <form className="inline-form" onSubmit={(e) => createItem(e, day.id)}>
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
                          className="btn-text add-item-btn"
                          onClick={() => setShowItemFormForDay(day.id)}
                        >
                          + 予定を追加
                        </button>
                      )}
                    </div>
                  )
                })
            )}

            {/* Add day form */}
            <div className="add-day-section">
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
                <button
                  className="btn-outline"
                  onClick={() => setShowDayForm(true)}
                >
                  + 日程を追加
                </button>
              )}
            </div>

            <button
              className="btn-text back-btn"
              onClick={() => setSelectedTrip(null)}
            >
              ← 旅程一覧に戻る
            </button>
          </>
        )}

        {/* Trip list section */}
        {!selectedTrip && (
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
                  <input
                    type="date"
                    value={newTripStartDate}
                    onChange={(e) => setNewTripStartDate(e.target.value)}
                    className="input"
                  />
                  <span className="date-separator">〜</span>
                  <input
                    type="date"
                    value={newTripEndDate}
                    onChange={(e) => setNewTripEndDate(e.target.value)}
                    className="input"
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

      <footer className="footer">
        <span className="footer-text">旅程</span>
      </footer>
    </div>
  )
}

export default App
