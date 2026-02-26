import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import type { Trip, TripTheme } from '../types'
import { formatDateRange } from '../utils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { SkeletonTripCard } from '../components/Skeleton'

type TripStyle = 'relaxed' | 'active' | 'gourmet' | 'sightseeing'
type SortOption = 'created_desc' | 'created_asc' | 'start_date_desc' | 'start_date_asc'
type ThemeFilter = '' | 'quiet' | 'photo'
type ArchiveTab = 'active' | 'archived'

export function TripListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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

  // Archive tab state
  const [archiveTab, setArchiveTab] = useState<ArchiveTab>(
    (searchParams.get('archived') === '1' ? 'archived' : 'active') as ArchiveTab
  )
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  // Search and filter state (synced with URL)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [filterStartDate, setFilterStartDate] = useState(searchParams.get('dateFrom') || '')
  const [filterEndDate, setFilterEndDate] = useState(searchParams.get('dateTo') || '')
  const [filterTheme, setFilterTheme] = useState<ThemeFilter>((searchParams.get('theme') as ThemeFilter) || '')
  const [sortOrder, setSortOrder] = useState<SortOption>((searchParams.get('sort') as SortOption) || 'created_desc')
  const [showFilters, setShowFilters] = useState(
    !!(searchParams.get('dateFrom') || searchParams.get('dateTo') || searchParams.get('theme') || searchParams.get('sort'))
  )

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

  const fetchAiUsage = useCallback(async () => {
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
  }, [])

  // Build URL params for API call
  const buildApiUrl = useCallback(() => {
    const params = new URLSearchParams()
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    if (filterTheme) params.set('theme', filterTheme)
    if (filterStartDate) params.set('dateFrom', filterStartDate)
    if (filterEndDate) params.set('dateTo', filterEndDate)
    if (sortOrder !== 'created_desc') params.set('sort', sortOrder)
    params.set('archived', archiveTab === 'archived' ? '1' : '0')
    const queryString = params.toString()
    return queryString ? `/api/trips?${queryString}` : '/api/trips'
  }, [searchQuery, filterTheme, filterStartDate, filterEndDate, sortOrder, archiveTab])

  const fetchTrips = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl())
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
  }, [showError, buildApiUrl])

  useEffect(() => {
    if (!authLoading) {
      fetchTrips()
      if (user) {
        fetchAiUsage()
      }
    }
  }, [authLoading, user, fetchTrips, fetchAiUsage])

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    if (filterTheme) params.set('theme', filterTheme)
    if (filterStartDate) params.set('dateFrom', filterStartDate)
    if (filterEndDate) params.set('dateTo', filterEndDate)
    if (sortOrder !== 'created_desc') params.set('sort', sortOrder)
    if (archiveTab === 'archived') params.set('archived', '1')
    setSearchParams(params, { replace: true })
  }, [searchQuery, filterTheme, filterStartDate, filterEndDate, sortOrder, archiveTab, setSearchParams])

  // Debounced search to avoid too many API calls
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      setLoading(true)
    }, 300)
  }, [])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return !!(searchQuery.trim() || filterTheme || filterStartDate || filterEndDate || sortOrder !== 'created_desc')
  }, [searchQuery, filterTheme, filterStartDate, filterEndDate, sortOrder])

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setFilterTheme('')
    setFilterStartDate('')
    setFilterEndDate('')
    setSortOrder('created_desc')
  }, [])

  // Toggle archive status
  const toggleArchive = useCallback(async (tripId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setArchivingId(tripId)
    try {
      const res = await fetch(`/api/trips/${tripId}/archive`, { method: 'PUT' })
      if (!res.ok) {
        showError('アーカイブの変更に失敗しました')
        return
      }
      // Remove the trip from current list (it will now be in the other tab)
      setTrips(prev => prev.filter(t => t.id !== tripId))
    } catch (err) {
      console.error('Failed to toggle archive:', err)
      showError('アーカイブの変更に失敗しました')
    } finally {
      setArchivingId(null)
    }
  }, [showError])

  // Duplicate trip
  const duplicateTrip = useCallback(async (tripId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDuplicatingId(tripId)
    try {
      const res = await fetch(`/api/trips/${tripId}/duplicate`, { method: 'POST' })
      const data = (await res.json()) as { tripId?: string; error?: string }
      if (!res.ok) {
        showError(data.error || '複製に失敗しました')
        return
      }
      if (data.tripId) {
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to duplicate trip:', err)
      showError('複製に失敗しました')
    } finally {
      setDuplicatingId(null)
    }
  }, [navigate, showError])

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
      <div className="trip-list-section">
        <div className="section-header">
          <span className="section-title">マイ旅程</span>
        </div>
        <SkeletonTripCard />
        <SkeletonTripCard />
        <SkeletonTripCard />
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
          <Link to="/templates" className="btn-text">
            テンプレート
          </Link>
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

      {/* Archive tabs */}
      {user && (
        <div className="archive-tabs">
          <button
            type="button"
            className={`archive-tab ${archiveTab === 'active' ? 'active' : ''}`}
            onClick={() => {
              setArchiveTab('active')
              setLoading(true)
            }}
          >
            アクティブ
          </button>
          <button
            type="button"
            className={`archive-tab ${archiveTab === 'archived' ? 'active' : ''}`}
            onClick={() => {
              setArchiveTab('archived')
              setLoading(true)
            }}
          >
            アーカイブ済み
          </button>
        </div>
      )}

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
      <div className="search-filter-section">
        <div className="search-bar">
          <input
            type="text"
            placeholder="タイトルで検索..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="input search-input"
          />
          <button
            type="button"
            className={`btn-text filter-toggle ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? '閉じる' : '絞り込み'}
            {hasActiveFilters && !showFilters && <span className="filter-indicator" />}
          </button>
        </div>
        {showFilters && (
          <div className="filter-options">
            {/* Theme filter */}
            <div className="filter-row">
              <label className="filter-label">テーマ</label>
              <div className="filter-buttons">
                <button
                  type="button"
                  className={`filter-btn ${filterTheme === '' ? 'active' : ''}`}
                  onClick={() => setFilterTheme('')}
                >
                  すべて
                </button>
                <button
                  type="button"
                  className={`filter-btn ${filterTheme === 'quiet' ? 'active' : ''}`}
                  onClick={() => setFilterTheme('quiet')}
                >
                  しずか
                </button>
                <button
                  type="button"
                  className={`filter-btn ${filterTheme === 'photo' ? 'active' : ''}`}
                  onClick={() => setFilterTheme('photo')}
                >
                  写真映え
                </button>
              </div>
            </div>
            {/* Date range filter */}
            <div className="filter-row">
              <label className="filter-label">期間</label>
              <div className="date-inputs filter-date-inputs">
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="input"
                />
                <span className="date-separator">〜</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="input"
                />
              </div>
            </div>
            {/* Sort order */}
            <div className="filter-row">
              <label className="filter-label">並び順</label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOption)}
                className="input sort-select"
              >
                <option value="created_desc">作成日（新しい順）</option>
                <option value="created_asc">作成日（古い順）</option>
                <option value="start_date_desc">開始日（新しい順）</option>
                <option value="start_date_asc">開始日（古い順）</option>
              </select>
            </div>
            {/* Clear filters button */}
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-text clear-filters-btn"
                onClick={clearFilters}
              >
                フィルターをクリア
              </button>
            )}
          </div>
        )}
        {/* Active filters summary */}
        {hasActiveFilters && !showFilters && (
          <div className="active-filters">
            {searchQuery.trim() && (
              <span className="filter-tag">
                「{searchQuery.trim()}」
                <button type="button" onClick={() => setSearchQuery('')} className="filter-tag-remove">x</button>
              </span>
            )}
            {filterTheme && (
              <span className="filter-tag">
                {filterTheme === 'quiet' ? 'しずか' : '写真映え'}
                <button type="button" onClick={() => setFilterTheme('')} className="filter-tag-remove">x</button>
              </span>
            )}
            {(filterStartDate || filterEndDate) && (
              <span className="filter-tag">
                {filterStartDate || '...'} 〜 {filterEndDate || '...'}
                <button type="button" onClick={() => { setFilterStartDate(''); setFilterEndDate('') }} className="filter-tag-remove">x</button>
              </span>
            )}
            {sortOrder !== 'created_desc' && (
              <span className="filter-tag">
                {sortOrder === 'created_asc' && '作成日（古い順）'}
                {sortOrder === 'start_date_desc' && '開始日（新しい順）'}
                {sortOrder === 'start_date_asc' && '開始日（古い順）'}
                <button type="button" onClick={() => setSortOrder('created_desc')} className="filter-tag-remove">x</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Trip list - now uses API-based filtering */}
      {trips.length === 0 && !hasActiveFilters ? (
        <div className="empty-state">
          <div className="empty-state-icon">—</div>
          <p className="empty-state-text">
            {archiveTab === 'archived' ? (
              'アーカイブ済みの旅程はありません'
            ) : (
              <>
                まだ旅程がありません。<br />
                あたらしい旅程をつくりましょう。
              </>
            )}
          </p>
        </div>
      ) : trips.length === 0 && hasActiveFilters ? (
        <div className="empty-state">
          <p className="empty-state-text">
            検索条件に一致する旅程がありません
          </p>
          <button
            type="button"
            className="btn-text"
            onClick={clearFilters}
          >
            条件をクリア
          </button>
        </div>
      ) : (
        trips.map((trip) => (
          <div
            key={trip.id}
            className={`trip-card ${trip.isArchived ? 'trip-card-archived' : ''}`}
            onClick={() => navigate(`/trips/${trip.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <div className="trip-card-header">
              <div className="trip-card-title">{trip.title}</div>
              {trip.theme && (
                <span className={`trip-card-theme trip-card-theme-${trip.theme}`}>
                  {trip.theme === 'quiet' ? 'しずか' : '写真映え'}
                </span>
              )}
            </div>
            {(trip.startDate || trip.endDate) && (
              <div className="trip-card-date">
                {trip.startDate && trip.endDate
                  ? formatDateRange(trip.startDate, trip.endDate)
                  : trip.startDate || trip.endDate}
              </div>
            )}
            {user && (
              <div className="trip-card-actions">
                <button
                  type="button"
                  className="btn-text btn-small duplicate-btn"
                  onClick={(e) => duplicateTrip(trip.id, e)}
                  disabled={duplicatingId === trip.id}
                >
                  {duplicatingId === trip.id ? '複製中...' : '複製'}
                </button>
                <button
                  type="button"
                  className="btn-text btn-small archive-btn"
                  onClick={(e) => toggleArchive(trip.id, e)}
                  disabled={archivingId === trip.id}
                >
                  {archivingId === trip.id
                    ? '処理中...'
                    : trip.isArchived
                      ? 'アーカイブ解除'
                      : 'アーカイブ'}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
