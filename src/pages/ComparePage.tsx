import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type { TripTheme } from '../types'

type ComparisonTrip = {
  comparisonTripId: string
  id: string
  label: string | null
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme
  coverImageUrl: string | null
  budget: number | null
  days: number
  totalCost: number
  itemCount: number
  areas: string[]
}

type ComparisonGroup = {
  id: string
  name: string
  createdAt: string
  trips: ComparisonTrip[]
}

function formatCost(cost: number): string {
  return `\u00A5${cost.toLocaleString()}`
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '-'
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(s)} - ${fmt(e)}`
}

function getThemeName(theme: TripTheme): string {
  switch (theme) {
    case 'quiet':
      return 'しずか'
    case 'photo':
      return '写真映え'
    case 'retro':
      return 'レトロ'
    default:
      return theme
  }
}

export function ComparePage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showError, showSuccess } = useToast()

  const [group, setGroup] = useState<ComparisonGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingLabels, setEditingLabels] = useState(false)
  const [labels, setLabels] = useState<string[]>([])
  const [savingLabels, setSavingLabels] = useState(false)
  const [adoptingTripId, setAdoptingTripId] = useState<string | null>(null)
  const [showAdoptConfirm, setShowAdoptConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchGroup = useCallback(async () => {
    if (!groupId) return

    try {
      const res = await fetch(`/api/comparisons/${groupId}`)
      const data = await res.json() as ComparisonGroup | { error: string }

      if (!res.ok) {
        showError((data as { error: string }).error || '比較グループの読み込みに失敗しました')
        navigate('/trips')
        return
      }

      setGroup(data as ComparisonGroup)
      setLabels((data as ComparisonGroup).trips.map(t => t.label || ''))
    } catch (err) {
      console.error('Failed to fetch comparison group:', err)
      showError('比較グループの読み込みに失敗しました')
      navigate('/trips')
    } finally {
      setLoading(false)
    }
  }, [groupId, navigate, showError])

  useEffect(() => {
    if (!authLoading && user) {
      fetchGroup()
    } else if (!authLoading && !user) {
      navigate('/login')
    }
  }, [authLoading, user, fetchGroup, navigate])

  // Calculate stats and find best values
  const stats = useMemo(() => {
    if (!group) return null

    const trips = group.trips
    const minCost = Math.min(...trips.map(t => t.totalCost))
    const maxDays = Math.max(...trips.map(t => t.days))
    const maxItems = Math.max(...trips.map(t => t.itemCount))
    const maxAreas = Math.max(...trips.map(t => t.areas.length))

    return {
      minCost,
      maxDays,
      maxItems,
      maxAreas,
    }
  }, [group])

  async function saveLabels() {
    if (!group) return

    setSavingLabels(true)
    try {
      const res = await fetch(`/api/comparisons/${group.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels }),
      })

      if (!res.ok) {
        const data = await res.json() as { error: string }
        showError(data.error || 'ラベルの保存に失敗しました')
        return
      }

      showSuccess('ラベルを保存しました')
      setEditingLabels(false)
      fetchGroup()
    } catch (err) {
      console.error('Failed to save labels:', err)
      showError('ラベルの保存に失敗しました')
    } finally {
      setSavingLabels(false)
    }
  }

  async function handleAdopt(tripId: string, deleteOthers: boolean) {
    if (!group) return

    setAdoptingTripId(tripId)
    try {
      const res = await fetch(`/api/comparisons/${group.id}/adopt/${tripId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteOthers }),
      })

      if (!res.ok) {
        const data = await res.json() as { error: string }
        showError(data.error || '旅程の採用に失敗しました')
        return
      }

      showSuccess(deleteOthers ? '旅程を採用し、他の旅程を削除しました' : '旅程を採用しました')
      navigate(`/trips/${tripId}`)
    } catch (err) {
      console.error('Failed to adopt trip:', err)
      showError('旅程の採用に失敗しました')
    } finally {
      setAdoptingTripId(null)
      setShowAdoptConfirm(null)
    }
  }

  async function handleDelete() {
    if (!group || !confirm('この比較グループを削除しますか？\n(旅程自体は削除されません)')) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/comparisons/${group.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json() as { error: string }
        showError(data.error || '比較グループの削除に失敗しました')
        return
      }

      showSuccess('比較グループを削除しました')
      navigate('/trips')
    } catch (err) {
      console.error('Failed to delete comparison group:', err)
      showError('比較グループの削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="compare-page">
        <div className="compare-loading">読み込み中...</div>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="compare-page">
        <div className="compare-error">
          <p>比較グループが見つかりません</p>
          <Link to="/trips" className="btn-outline">旅程一覧に戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="compare-page">
      <div className="compare-header">
        <div className="compare-header-main">
          <h1 className="compare-title">{group.name}</h1>
          <p className="compare-subtitle">{group.trips.length}つの旅程を比較中</p>
        </div>
        <div className="compare-header-actions">
          {!editingLabels ? (
            <button
              type="button"
              className="btn-text"
              onClick={() => setEditingLabels(true)}
            >
              ラベルを編集
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setEditingLabels(false)
                  setLabels(group.trips.map(t => t.label || ''))
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-filled"
                onClick={saveLabels}
                disabled={savingLabels}
              >
                {savingLabels ? '保存中...' : '保存'}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-text btn-danger"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '削除中...' : '比較を削除'}
          </button>
        </div>
      </div>

      <div className="compare-grid" data-count={group.trips.length}>
        {group.trips.map((trip, index) => (
          <div key={trip.id} className="compare-card">
            {/* Header with label */}
            <div className="compare-card-header">
              {editingLabels ? (
                <input
                  type="text"
                  className="input compare-label-input"
                  value={labels[index] || ''}
                  onChange={(e) => {
                    const newLabels = [...labels]
                    newLabels[index] = e.target.value
                    setLabels(newLabels)
                  }}
                  placeholder={`プラン${String.fromCharCode(65 + index)}`}
                />
              ) : (
                <span className="compare-card-label">
                  {trip.label || `プラン${String.fromCharCode(65 + index)}`}
                </span>
              )}
            </div>

            {/* Cover image or placeholder */}
            {trip.coverImageUrl ? (
              <div className="compare-card-cover">
                <img src={trip.coverImageUrl} alt={trip.title} />
              </div>
            ) : (
              <div className="compare-card-cover compare-card-cover-placeholder">
                <span>{trip.title.charAt(0)}</span>
              </div>
            )}

            {/* Trip info */}
            <div className="compare-card-info">
              <h3 className="compare-card-title">{trip.title}</h3>
              <p className="compare-card-dates">
                {formatDateRange(trip.startDate, trip.endDate)}
              </p>
            </div>

            {/* Stats */}
            <div className="compare-card-stats">
              <div className={`compare-stat ${stats && trip.days === stats.maxDays ? 'compare-stat-highlight' : ''}`}>
                <span className="compare-stat-label">日数</span>
                <span className="compare-stat-value">{trip.days}日</span>
              </div>

              <div className={`compare-stat ${stats && trip.totalCost === stats.minCost && trip.totalCost > 0 ? 'compare-stat-highlight compare-stat-best' : ''}`}>
                <span className="compare-stat-label">総費用</span>
                <span className="compare-stat-value">
                  {trip.totalCost > 0 ? formatCost(trip.totalCost) : '-'}
                </span>
                {stats && trip.totalCost === stats.minCost && trip.totalCost > 0 && (
                  <span className="compare-stat-badge">最安</span>
                )}
              </div>

              <div className={`compare-stat ${stats && trip.itemCount === stats.maxItems ? 'compare-stat-highlight' : ''}`}>
                <span className="compare-stat-label">スポット数</span>
                <span className="compare-stat-value">{trip.itemCount}件</span>
              </div>

              <div className="compare-stat">
                <span className="compare-stat-label">テーマ</span>
                <span className={`compare-stat-value compare-stat-theme compare-stat-theme-${trip.theme}`}>
                  {getThemeName(trip.theme)}
                </span>
              </div>

              <div className="compare-stat compare-stat-areas">
                <span className="compare-stat-label">訪問エリア</span>
                <div className="compare-stat-value compare-areas-list">
                  {trip.areas.length > 0 ? (
                    trip.areas.slice(0, 5).map((area, i) => (
                      <span key={i} className="compare-area-tag">{area}</span>
                    ))
                  ) : (
                    <span className="compare-no-data">-</span>
                  )}
                  {trip.areas.length > 5 && (
                    <span className="compare-area-more">+{trip.areas.length - 5}</span>
                  )}
                </div>
              </div>

              {trip.budget && (
                <div className="compare-stat">
                  <span className="compare-stat-label">予算</span>
                  <span className="compare-stat-value">{formatCost(trip.budget)}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="compare-card-actions">
              <Link
                to={`/trips/${trip.id}`}
                className="btn-outline compare-view-btn"
              >
                詳細を見る
              </Link>
              <button
                type="button"
                className="btn-filled compare-adopt-btn"
                onClick={() => setShowAdoptConfirm(trip.id)}
                disabled={adoptingTripId === trip.id}
              >
                {adoptingTripId === trip.id ? '処理中...' : 'この旅程を採用'}
              </button>
            </div>

            {/* Adopt confirmation modal */}
            {showAdoptConfirm === trip.id && (
              <div className="compare-adopt-confirm">
                <div className="compare-adopt-confirm-content">
                  <h4>「{trip.title}」を採用しますか？</h4>
                  <p>比較グループは削除されます。</p>
                  <div className="compare-adopt-options">
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => handleAdopt(trip.id, false)}
                      disabled={adoptingTripId !== null}
                    >
                      他の旅程を残す
                    </button>
                    <button
                      type="button"
                      className="btn-filled btn-danger"
                      onClick={() => handleAdopt(trip.id, true)}
                      disabled={adoptingTripId !== null}
                    >
                      他の旅程を削除
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn-text compare-adopt-cancel"
                    onClick={() => setShowAdoptConfirm(null)}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="compare-footer">
        <Link to="/trips" className="btn-text">
          旅程一覧に戻る
        </Link>
      </div>
    </div>
  )
}
