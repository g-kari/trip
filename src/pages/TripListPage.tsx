import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import type { Trip, TripTheme, ColorLabel } from '../types'
import { formatDateRange } from '../utils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { SkeletonTripCard } from '../components/Skeleton'
import { PinIcon, PinFilledIcon, CopyIcon, MoreVerticalIcon, PlusIcon, ArchiveIcon, UnarchiveIcon } from '../components/Icons'
import { TemplateListModal } from '../components/TemplateListModal'
import { CountdownWidget } from '../components/CountdownWidget'
import { ColorLabelFilter, ColorLabelIndicator } from '../components/ColorLabelPicker'
import { DatePicker } from '../components/DatePicker'

type TripStyle = 'relaxed' | 'active' | 'gourmet' | 'sightseeing'
type SortOption = 'created_desc' | 'created_asc' | 'start_date_desc' | 'start_date_asc'
type ThemeFilter = '' | 'quiet' | 'photo' | 'retro' | 'natural'
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
  const [pinningId, setPinningId] = useState<string | null>(null)

  // Search and filter state (synced with URL)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  const [filterStartDate, setFilterStartDate] = useState(searchParams.get('dateFrom') || '')
  const [filterEndDate, setFilterEndDate] = useState(searchParams.get('dateTo') || '')
  const [filterTheme, setFilterTheme] = useState<ThemeFilter>((searchParams.get('theme') as ThemeFilter) || '')
  const [filterTag, setFilterTag] = useState(searchParams.get('tag') || '')
  const [filterColor, setFilterColor] = useState<ColorLabel | ''>((searchParams.get('color') as ColorLabel | '') || '')
  const [sortOrder, setSortOrder] = useState<SortOption>((searchParams.get('sort') as SortOption) || 'created_desc')
  const [showFilters, setShowFilters] = useState(
    !!(searchParams.get('dateFrom') || searchParams.get('dateTo') || searchParams.get('theme') || searchParams.get('sort') || searchParams.get('tag') || searchParams.get('color'))
  )

  // Available tags state
  const [availableTags, setAvailableTags] = useState<string[]>([])

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

  // Import state
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Template modal state
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false)

  // Action menu state
  const [activeMenu, setActiveMenu] = useState<'create' | 'more' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close action menu on click outside
  useEffect(() => {
    if (!activeMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeMenu])

  const fetchAiUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/usage')
      if (res.ok) {
        const data = (await res.json()) as { credits: number; maxCredits: number; costs: { generate: number; suggestions: number; optimize: number }; resetDate: string; loggedIn: boolean }
        setAiRemaining(data.credits)
        setAiLimitReached(data.credits < 2)
      }
    } catch (err) {
      console.error('Failed to fetch AI usage:', err)
    }
  }, [])

  // Build URL params for API call (uses debounced search to avoid mid-typing fetches)
  const buildApiUrl = useCallback(() => {
    const params = new URLSearchParams()
    if (debouncedSearchQuery.trim()) params.set('q', debouncedSearchQuery.trim())
    if (filterTheme) params.set('theme', filterTheme)
    if (filterTag) params.set('tag', filterTag)
    if (filterColor) params.set('color', filterColor)
    if (filterStartDate) params.set('dateFrom', filterStartDate)
    if (filterEndDate) params.set('dateTo', filterEndDate)
    if (sortOrder !== 'created_desc') params.set('sort', sortOrder)
    params.set('archived', archiveTab === 'archived' ? '1' : '0')
    const queryString = params.toString()
    return queryString ? `/api/trips?${queryString}` : '/api/trips'
  }, [debouncedSearchQuery, filterTheme, filterTag, filterColor, filterStartDate, filterEndDate, sortOrder, archiveTab])

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

  // Fetch available tags for filtering
  const fetchAvailableTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags')
      if (res.ok) {
        const data = await res.json() as { tags: string[]; suggestedTags: string[] }
        setAvailableTags(data.tags || [])
      }
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    }
  }, [])

  useEffect(() => {
    if (!authLoading) {
      fetchTrips()
      if (user) {
        fetchAiUsage()
        fetchAvailableTags()
      }
    }
  }, [authLoading, user, fetchTrips, fetchAiUsage, fetchAvailableTags])

  // Debounce search query to avoid re-renders on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Update URL params when filters change (uses debounced search)
  useEffect(() => {
    const params = new URLSearchParams()
    if (debouncedSearchQuery.trim()) params.set('q', debouncedSearchQuery.trim())
    if (filterTheme) params.set('theme', filterTheme)
    if (filterTag) params.set('tag', filterTag)
    if (filterColor) params.set('color', filterColor)
    if (filterStartDate) params.set('dateFrom', filterStartDate)
    if (filterEndDate) params.set('dateTo', filterEndDate)
    if (sortOrder !== 'created_desc') params.set('sort', sortOrder)
    if (archiveTab === 'archived') params.set('archived', '1')
    setSearchParams(params, { replace: true })
  }, [debouncedSearchQuery, filterTheme, filterTag, filterColor, filterStartDate, filterEndDate, sortOrder, archiveTab, setSearchParams])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
  }, [])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return !!(debouncedSearchQuery.trim() || filterTheme || filterTag || filterColor || filterStartDate || filterEndDate || sortOrder !== 'created_desc')
  }, [debouncedSearchQuery, filterTheme, filterTag, filterColor, filterStartDate, filterEndDate, sortOrder])

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setFilterTheme('')
    setFilterTag('')
    setFilterColor('')
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

  // Toggle pin status
  const togglePin = useCallback(async (tripId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setPinningId(tripId)
    try {
      const res = await fetch(`/api/trips/${tripId}/pin`, { method: 'PATCH' })
      if (!res.ok) {
        showError('ピン留めの変更に失敗しました')
        return
      }
      const data = (await res.json()) as { pinned: boolean }
      // Update the trip in the list and re-sort (pinned trips first)
      setTrips(prev => {
        const updated = prev.map(t =>
          t.id === tripId ? { ...t, pinned: data.pinned } : t
        )
        // Sort: pinned first, then by original order
        return updated.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1
          if (!a.pinned && b.pinned) return 1
          return 0
        })
      })
    } catch (err) {
      console.error('Failed to toggle pin:', err)
      showError('ピン留めの変更に失敗しました')
    } finally {
      setPinningId(null)
    }
  }, [showError])

  // Duplicate trip
  const duplicateTrip = useCallback(async (tripId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('この旅程を複製しますか？')) return
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
      const data = (await res.json()) as { trip?: Trip; error?: string; code?: string }
      if (!res.ok) {
        if (data.code === 'SLOT_LIMIT_REACHED') {
          showError('旅程枠が不足しています。プロフィールから追加の枠を購入してください。')
          navigate('/profile')
        } else {
          showError(data.error || '旅程の作成に失敗しました')
        }
        return
      }
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

      const data = (await res.json()) as { trip?: Trip; tripId?: string; error?: string; code?: string; remaining?: number; limitReached?: boolean }
      if (!res.ok) {
        if (data.code === 'SLOT_LIMIT_REACHED') {
          showError('旅程枠が不足しています。プロフィールから追加の枠を購入してください。')
          navigate('/profile')
          return
        }
        setAiError(data.error || 'エラーが発生しました')
        if (data.limitReached) {
          setAiLimitReached(true)
          setAiRemaining(0)
        }
        return
      }
      if (data.remaining !== undefined) {
        setAiRemaining(data.remaining)
        setAiLimitReached(data.limitReached === true)
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

  async function createFromTemplate(templateId: string, title: string, startDate: string) {
    setCreatingFromTemplate(true)
    try {
      const res = await fetch(`/api/trips/from-template/${templateId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, startDate }),
      })
      const data = (await res.json()) as { tripId?: string; error?: string; code?: string }

      if (!res.ok) {
        if (data.code === 'SLOT_LIMIT_REACHED') {
          showError('旅程枠が不足しています。プロフィールから追加の枠を購入してください。')
          navigate('/profile')
          return
        }
        showError(data.error || 'テンプレートからの作成に失敗しました')
        return
      }

      if (data.tripId) {
        setShowTemplateModal(false)
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to create from template:', err)
      showError('テンプレートからの作成に失敗しました')
    } finally {
      setCreatingFromTemplate(false)
    }
  }

  async function handleImport(file: File) {
    if (!file) return

    // Validate file type
    if (!file.name.endsWith('.json')) {
      showError('JSONファイルを選択してください')
      return
    }

    setImporting(true)
    try {
      const text = await file.text()
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        showError('無効なJSONファイルです')
        setImporting(false)
        return
      }

      const res = await fetch('/api/trips/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = (await res.json()) as { tripId?: string; error?: string }
      if (!res.ok) {
        showError(result.error || 'インポートに失敗しました')
        return
      }

      if (result.tripId) {
        navigate(`/trips/${result.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to import trip:', err)
      showError('インポートに失敗しました')
    } finally {
      setImporting(false)
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
        <div className="flex flex-col gap-[var(--space-3)] w-full max-w-[280px]">
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
        <div className="flex gap-[var(--space-2)]" ref={menuRef}>
          <div className="relative">
            <button
              type="button"
              className="btn-icon action-icon-btn"
              data-tooltip="作成"
              onClick={() => setActiveMenu(activeMenu === 'create' ? null : 'create')}
            >
              <PlusIcon size={18} />
            </button>
            {activeMenu === 'create' && (
              <div className="action-dropdown">
                <button
                  type="button"
                  className="action-dropdown-item"
                  onClick={() => {
                    setShowAiForm(!showAiForm)
                    setShowCreateForm(false)
                    setActiveMenu(null)
                  }}
                >
                  {showAiForm ? 'AI作成を閉じる' : '✨ AIで作成'}
                </button>
                <button
                  type="button"
                  className="action-dropdown-item"
                  onClick={() => {
                    setShowCreateForm(!showCreateForm)
                    setShowAiForm(false)
                    setActiveMenu(null)
                  }}
                >
                  {showCreateForm ? '手動作成を閉じる' : '手動で作成'}
                </button>
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              className="btn-icon action-icon-btn"
              data-tooltip="その他"
              onClick={() => setActiveMenu(activeMenu === 'more' ? null : 'more')}
            >
              <MoreVerticalIcon size={18} />
            </button>
            {activeMenu === 'more' && (
              <div className="action-dropdown">
                <Link
                  to="/templates"
                  className="action-dropdown-item"
                  onClick={() => setActiveMenu(null)}
                >
                  テンプレート一覧
                </Link>
                {user && (
                  <>
                    <button
                      type="button"
                      className="action-dropdown-item"
                      onClick={() => {
                        setShowTemplateModal(true)
                        setActiveMenu(null)
                      }}
                      disabled={creatingFromTemplate}
                    >
                      テンプレートから作成
                    </button>
                    <button
                      type="button"
                      className="action-dropdown-item"
                      onClick={() => {
                        importInputRef.current?.click()
                        setActiveMenu(null)
                      }}
                      disabled={importing}
                    >
                      {importing ? 'インポート中...' : 'インポート'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                handleImport(file)
              }
              e.target.value = ''
            }}
          />
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
              <p>AIクレジットが不足しています</p>
              <p className="ai-limit-hint">毎月1日にリセットされます</p>
            </div>
          ) : (
            <>
              {aiRemaining !== null && (
                <p className="ai-remaining">残りクレジット: {aiRemaining} / 5</p>
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
            <DatePicker
              value={aiStartDate}
              onChange={setAiStartDate}
              placeholder="開始日"
            />
            <span className="date-separator">〜</span>
            <DatePicker
              value={aiEndDate}
              onChange={setAiEndDate}
              placeholder="終了日"
              min={aiStartDate}
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
            {generating ? '生成中...' : 'AIで生成する（2クレジット）'}
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
            <DatePicker
              value={newTripStartDate}
              onChange={setNewTripStartDate}
              placeholder="開始日"
            />
            <span className="date-separator">〜</span>
            <DatePicker
              value={newTripEndDate}
              onChange={setNewTripEndDate}
              placeholder="終了日"
              min={newTripStartDate}
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
            <button
              type="button"
              className={`theme-btn ${newTripTheme === 'retro' ? 'active' : ''}`}
              onClick={() => setNewTripTheme('retro')}
            >
              レトロ
            </button>
            <button
              type="button"
              className={`theme-btn ${newTripTheme === 'natural' ? 'active' : ''}`}
              onClick={() => setNewTripTheme('natural')}
            >
              ナチュラル
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
                <button
                  type="button"
                  className={`filter-btn ${filterTheme === 'retro' ? 'active' : ''}`}
                  onClick={() => setFilterTheme('retro')}
                >
                  レトロ
                </button>
                <button
                  type="button"
                  className={`filter-btn ${filterTheme === 'natural' ? 'active' : ''}`}
                  onClick={() => setFilterTheme('natural')}
                >
                  ナチュラル
                </button>
              </div>
            </div>
            {/* Color label filter */}
            <div className="filter-row">
              <label className="filter-label">カラー</label>
              <ColorLabelFilter
                value={filterColor}
                onChange={setFilterColor}
              />
            </div>
            {/* Tag filter */}
            {availableTags.length > 0 && (
              <div className="filter-row">
                <label className="filter-label">タグ</label>
                <div className="filter-tags">
                  <button
                    type="button"
                    className={`filter-tag-btn ${filterTag === '' ? 'active' : ''}`}
                    onClick={() => setFilterTag('')}
                  >
                    すべて
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`filter-tag-btn ${filterTag === tag ? 'active' : ''}`}
                      onClick={() => setFilterTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Date range filter */}
            <div className="filter-row">
              <label className="filter-label">期間</label>
              <div className="date-inputs filter-date-inputs">
                <DatePicker
                  value={filterStartDate}
                  onChange={setFilterStartDate}
                  placeholder="開始日"
                />
                <span className="date-separator">〜</span>
                <DatePicker
                  value={filterEndDate}
                  onChange={setFilterEndDate}
                  placeholder="終了日"
                  min={filterStartDate}
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
                {filterTheme === 'quiet' ? 'しずか' : filterTheme === 'photo' ? '写真映え' : filterTheme === 'retro' ? 'レトロ' : 'ナチュラル'}
                <button type="button" onClick={() => setFilterTheme('')} className="filter-tag-remove">x</button>
              </span>
            )}
            {filterTag && (
              <span className="filter-tag">
                {filterTag}
                <button type="button" onClick={() => setFilterTag('')} className="filter-tag-remove">x</button>
              </span>
            )}
            {filterColor && (
              <span className="filter-tag filter-tag-color">
                <span className={`filter-tag-color-dot filter-tag-color-dot-${filterColor}`} />
                <button type="button" onClick={() => setFilterColor('')} className="filter-tag-remove">x</button>
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
        <div className="flex flex-col gap-[var(--space-3)]">
          {trips.map((trip) => (
            <div key={trip.id}>
              <div
                className={`trip-card ${trip.isArchived ? 'trip-card-archived' : ''} ${trip.pinned ? 'trip-card-pinned' : ''}`}
                onClick={() => navigate(`/trips/${trip.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <ColorLabelIndicator color={trip.colorLabel} />
                <div className="trip-card-header">
                  <div className="trip-card-title-row">
                    {!!trip.pinned && (
                      <span className="trip-card-pin-indicator" title="ピン留め中">
                        <PinFilledIcon size={14} />
                      </span>
                    )}
                    <div className="trip-card-title">{trip.title}</div>
                  </div>
                  {trip.theme && (
                    <span className={`trip-card-theme trip-card-theme-${trip.theme}`}>
                      {trip.theme === 'quiet' ? 'しずか' : trip.theme === 'photo' ? '写真映え' : trip.theme === 'retro' ? 'レトロ' : 'ナチュラル'}
                    </span>
                  )}
                </div>
                {(trip.startDate || trip.endDate) && (
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <div className="trip-card-date">
                      {trip.startDate && trip.endDate
                        ? formatDateRange(trip.startDate, trip.endDate)
                        : trip.startDate || trip.endDate}
                    </div>
                    <CountdownWidget
                      startDate={trip.startDate}
                      endDate={trip.endDate}
                      compact
                    />
                  </div>
                )}
                {trip.tags && trip.tags.length > 0 && (
                  <div className="trip-card-tags">
                    {trip.tags.map((tag) => (
                      <span
                        key={tag}
                        className="trip-card-tag"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFilterTag(tag)
                          setShowFilters(true)
                        }}
                        title={`「${tag}」で絞り込み`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {user && (
                  <div className="trip-card-actions">
                    <button
                      type="button"
                      className={`btn-icon pin-btn ${trip.pinned ? 'pin-btn-active' : ''}`}
                      onClick={(e) => togglePin(trip.id, e)}
                      disabled={pinningId === trip.id}
                      title={trip.pinned ? 'ピン留め解除' : 'ピン留め'}
                    >
                      {trip.pinned ? <PinFilledIcon size={16} /> : <PinIcon size={16} />}
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={(e) => duplicateTrip(trip.id, e)}
                      disabled={duplicatingId === trip.id}
                      title="複製"
                    >
                      {duplicatingId === trip.id ? '...' : <CopyIcon size={16} />}
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={(e) => toggleArchive(trip.id, e)}
                      disabled={archivingId === trip.id}
                      title={trip.isArchived ? 'アーカイブ解除' : 'アーカイブ'}
                    >
                      {archivingId === trip.id
                        ? '...'
                        : trip.isArchived
                          ? <UnarchiveIcon size={16} />
                          : <ArchiveIcon size={16} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showTemplateModal && (
        <TemplateListModal
          onClose={() => setShowTemplateModal(false)}
          onSelect={createFromTemplate}
        />
      )}

    </div>
  )
}
