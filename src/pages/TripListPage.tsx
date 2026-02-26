import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { Trip, TripTheme } from '../types'
import { formatDateRange } from '../utils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'

type TripStyle = 'relaxed' | 'active' | 'gourmet' | 'sightseeing'

export function TripListPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showError } = useToast()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTripTitle, setNewTripTitle] = useState('')
  const [newTripStartDate, setNewTripStartDate] = useState('')
  const [newTripEndDate, setNewTripEndDate] = useState('')
  const [newTripTheme, setNewTripTheme] = useState<TripTheme>('quiet')
  const [creating, setCreating] = useState(false)

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStartDate, setFilterStartDate] = useState('')
  const [filterEndDate, setFilterEndDate] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // AI generation state
  const [showAiForm, setShowAiForm] = useState(false)
  const [aiDestination, setAiDestination] = useState('')
  const [aiStartDate, setAiStartDate] = useState('')
  const [aiEndDate, setAiEndDate] = useState('')
  const [aiStyle, setAiStyle] = useState<TripStyle>('sightseeing')
  const [aiBudget, setAiBudget] = useState('')
  const [aiNotes, setAiNotes] = useState('')
  const [aiImage, setAiImage] = useState<File | null>(null)
  const [aiImagePreview, setAiImagePreview] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiRemaining, setAiRemaining] = useState<number | null>(null)
  const [aiLimitReached, setAiLimitReached] = useState(false)
  const aiImageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!authLoading) {
      fetchTrips()
      if (user) {
        fetchAiUsage()
      }
    }
  }, [authLoading, user])

  async function fetchAiUsage() {
    try {
      const res = await fetch('/api/ai/usage')
      if (res.ok) {
        const data = (await res.json()) as { remaining: number; limit: number }
        setAiRemaining(data.remaining)
        setAiLimitReached(data.remaining <= 0)
      }
    } catch (err) {
      console.error('Failed to fetch AI usage:', err)
    }
  }

  async function fetchTrips() {
    try {
      const res = await fetch('/api/trips')
      if (!res.ok) {
        showError('旅程の読み込みに失敗しました')
        return
      }
      const data = (await res.json()) as { trips: Trip[] }
      setTrips(data.trips || [])
    } catch (err) {
      console.error('Failed to fetch trips:', err)
      showError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

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
          theme: newTripTheme,
        }),
      })
      const data = (await res.json()) as { trip: Trip }
      if (data.trip) {
        navigate(`/trips/${data.trip.id}/edit`)
      }
    } catch (err) {
      console.error('Failed to create trip:', err)
      showError('旅程の作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  function handleAiImageSelect(file: File | null) {
    if (file && !file.type.startsWith('image/')) {
      showError('画像ファイルを選択してください')
      return
    }
    if (file && file.size > 5 * 1024 * 1024) {
      showError('ファイルサイズは5MB以下にしてください')
      return
    }
    setAiImage(file)
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => setAiImagePreview(e.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setAiImagePreview(null)
    }
  }

  async function generateTrip(e: React.FormEvent) {
    e.preventDefault()
    if (!aiDestination.trim() || !aiStartDate || !aiEndDate) return

    setGenerating(true)
    setAiError(null)
    try {
      let res: Response

      if (aiImage) {
        // Use FormData for image upload
        const formData = new FormData()
        formData.append('destination', aiDestination.trim())
        formData.append('startDate', aiStartDate)
        formData.append('endDate', aiEndDate)
        formData.append('style', aiStyle)
        if (aiBudget) formData.append('budget', aiBudget)
        if (aiNotes) formData.append('notes', aiNotes)
        formData.append('image', aiImage)

        res = await fetch('/api/trips/generate', {
          method: 'POST',
          body: formData,
        })
      } else {
        res = await fetch('/api/trips/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: aiDestination.trim(),
            startDate: aiStartDate,
            endDate: aiEndDate,
            style: aiStyle,
            budget: aiBudget ? parseInt(aiBudget, 10) : undefined,
            notes: aiNotes || undefined,
          }),
        })
      }

      const data = (await res.json()) as { trip?: Trip; tripId?: string; error?: string; remaining?: number; limitReached?: boolean }
      if (!res.ok) {
        setAiError(data.error || 'エラーが発生しました')
        if (data.limitReached) {
          setAiLimitReached(true)
          setAiRemaining(0)
        }
        return
      }
      if (data.remaining !== undefined) {
        setAiRemaining(data.remaining)
        setAiLimitReached(data.remaining <= 0)
      }
      if (data.tripId) {
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to generate trip:', err)
      setAiError('旅程の生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">読み込み中...</p>
      </div>
    )
  }

  // Show login prompt if not logged in and no trips
  if (!user && trips.length === 0) {
    return (
      <div className="hero">
        <h1 className="hero-title">
          作るだけで綺麗。<br />
          旅の思い出を、<br />
          そのまま人に見せられる<br />
          ページに。
        </h1>
        <p className="hero-subtitle">旅程を作って、共有しましょう</p>
        <div className="hero-actions">
          <Link to="/login" className="btn-filled">
            ログインして始める
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="trip-list-section">
      <div className="section-header">
        <span className="section-title">{user ? 'マイ旅程' : 'trips'}</span>
        <div className="section-actions">
          <button
            className="btn-outline"
            onClick={() => {
              setShowAiForm(!showAiForm)
              setShowCreateForm(false)
            }}
          >
            {showAiForm ? 'キャンセル' : 'AIで作成'}
          </button>
          <button
            className="btn-outline"
            onClick={() => {
              setShowCreateForm(!showCreateForm)
              setShowAiForm(false)
            }}
          >
            {showCreateForm ? 'キャンセル' : '手動で作成'}
          </button>
        </div>
      </div>

      {showAiForm && (
        <form className="create-form ai-form" onSubmit={generateTrip}>
          <div className="ai-form-header">
            <span className="ai-form-icon">✨</span>
            <span className="ai-form-title">AIで旅程を自動生成</span>
          </div>
          {!user ? (
            <div className="ai-login-prompt">
              <p>AI生成にはログインが必要です</p>
              <Link to="/login" className="btn-filled">
                ログインする
              </Link>
            </div>
          ) : aiLimitReached ? (
            <div className="ai-limit-reached">
              <p>本日の利用上限に達しました</p>
              <p className="ai-limit-hint">明日また利用できます</p>
            </div>
          ) : (
            <>
              {aiRemaining !== null && (
                <p className="ai-remaining">本日の残り: {aiRemaining}回</p>
              )}
              <input
                type="text"
                placeholder="目的地（例: 京都、沖縄、パリ）"
                value={aiDestination}
                onChange={(e) => setAiDestination(e.target.value)}
                className="input"
                autoFocus
              />
          <div className="date-inputs">
            <input
              type="date"
              value={aiStartDate}
              onChange={(e) => setAiStartDate(e.target.value)}
              className="input"
            />
            <span className="date-separator">〜</span>
            <input
              type="date"
              value={aiEndDate}
              onChange={(e) => setAiEndDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="style-selector">
            <label className="style-label">旅のスタイル</label>
            <div className="style-options">
              <button
                type="button"
                className={`style-btn ${aiStyle === 'sightseeing' ? 'active' : ''}`}
                onClick={() => setAiStyle('sightseeing')}
              >
                観光重視
              </button>
              <button
                type="button"
                className={`style-btn ${aiStyle === 'relaxed' ? 'active' : ''}`}
                onClick={() => setAiStyle('relaxed')}
              >
                のんびり
              </button>
              <button
                type="button"
                className={`style-btn ${aiStyle === 'gourmet' ? 'active' : ''}`}
                onClick={() => setAiStyle('gourmet')}
              >
                グルメ
              </button>
              <button
                type="button"
                className={`style-btn ${aiStyle === 'active' ? 'active' : ''}`}
                onClick={() => setAiStyle('active')}
              >
                アクティブ
              </button>
            </div>
          </div>
          <input
            type="number"
            placeholder="予算（円、任意）"
            value={aiBudget}
            onChange={(e) => setAiBudget(e.target.value)}
            className="input"
          />
          <textarea
            placeholder="その他の要望（任意）"
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            className="input textarea"
            rows={2}
          />
          {/* Image input for AI */}
          <div className="ai-image-section">
            {aiImagePreview ? (
              <div className="ai-image-preview">
                <img src={aiImagePreview} alt="参考画像" className="ai-image-thumb" />
                <button
                  type="button"
                  className="btn-text btn-small"
                  onClick={() => handleAiImageSelect(null)}
                >
                  削除
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-outline btn-small"
                onClick={() => aiImageInputRef.current?.click()}
              >
                + 参考画像を追加（任意）
              </button>
            )}
            <input
              ref={aiImageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0] || null
                handleAiImageSelect(file)
                e.target.value = ''
              }}
            />
            <p className="ai-image-hint">旅行のチラシやスクリーンショットを添付すると、AIが参考にします</p>
          </div>
          {aiError && (
            <p className="error-text">{aiError}</p>
          )}
          <button
            type="submit"
            className="btn-filled"
            disabled={generating || !aiDestination.trim() || !aiStartDate || !aiEndDate}
          >
            {generating ? '生成中...' : 'AIで生成する'}
          </button>
          {generating && (
            <p className="generating-hint">AIが旅程を考えています...</p>
          )}
            </>
          )}
        </form>
      )}

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
          <div className="theme-selector">
            <button
              type="button"
              className={`theme-btn ${newTripTheme === 'quiet' ? 'active' : ''}`}
              onClick={() => setNewTripTheme('quiet')}
            >
              しずか
            </button>
            <button
              type="button"
              className={`theme-btn ${newTripTheme === 'photo' ? 'active' : ''}`}
              onClick={() => setNewTripTheme('photo')}
            >
              写真映え
            </button>
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

      {/* Search and Filter */}
      {trips.length > 0 && (
        <div className="search-filter-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="旅程を検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input search-input"
            />
            <button
              type="button"
              className={`btn-text filter-toggle ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              絞り込み
            </button>
          </div>
          {showFilters && (
            <div className="filter-options">
              <div className="filter-row">
                <label className="filter-label">期間</label>
                <div className="date-inputs">
                  <input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="input"
                    placeholder="開始日"
                  />
                  <span className="date-separator">〜</span>
                  <input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="input"
                    placeholder="終了日"
                  />
                </div>
              </div>
              {(filterStartDate || filterEndDate) && (
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setFilterStartDate('')
                    setFilterEndDate('')
                  }}
                >
                  フィルターをクリア
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(() => {
        // Filter trips based on search query and date range
        const filteredTrips = trips.filter((trip) => {
          // Text search
          if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase()
            if (!trip.title.toLowerCase().includes(query)) {
              return false
            }
          }
          // Date range filter
          if (filterStartDate && trip.startDate) {
            if (trip.startDate < filterStartDate) {
              return false
            }
          }
          if (filterEndDate && trip.endDate) {
            if (trip.endDate > filterEndDate) {
              return false
            }
          }
          return true
        })

        if (trips.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-icon">—</div>
              <p className="empty-state-text">
                まだ旅程がありません。<br />
                あたらしい旅程をつくりましょう。
              </p>
            </div>
          )
        }

        if (filteredTrips.length === 0) {
          return (
            <div className="empty-state">
              <p className="empty-state-text">
                検索条件に一致する旅程がありません
              </p>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setSearchQuery('')
                  setFilterStartDate('')
                  setFilterEndDate('')
                }}
              >
                条件をクリア
              </button>
            </div>
          )
        }

        return filteredTrips.map((trip) => (
          <div
            key={trip.id}
            className="trip-card"
            onClick={() => navigate(`/trips/${trip.id}`)}
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
      })()}
    </div>
  )
}
