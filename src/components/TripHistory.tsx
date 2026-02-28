import { useState, useEffect, useCallback, useRef } from 'react'
import type { TripHistoryEntry } from '../types'
import { HistoryIcon } from './Icons'
import { useEscapeKey } from '../hooks/useEscapeKey'

type Props = {
  tripId: string
  isOwner: boolean
  onClose: () => void
  onRestored: () => void
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}時間前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}日前`
  return date.toLocaleDateString('ja-JP')
}

function actionIcon(action: string): string {
  if (action.includes('create') || action.includes('generate')) return '＋'
  if (action.includes('delete')) return '－'
  if (action.includes('restore')) return '↩'
  if (action.includes('reorder')) return '↕'
  return '✎'
}

function actionColor(action: string): string {
  if (action.includes('create') || action.includes('generate')) return 'var(--color-success, #4a9)'
  if (action.includes('delete')) return 'var(--color-danger, #c55)'
  if (action.includes('restore')) return 'var(--color-accent)'
  return 'var(--color-text-muted)'
}

export function TripHistory({ tripId, isOwner, onClose, onRestored }: Props) {
  useEscapeKey(onClose)
  const [entries, setEntries] = useState<TripHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const fetchHistory = useCallback(async (cursor?: string | null) => {
    if (cursor) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const url = cursor
        ? `/api/trips/${tripId}/history?cursor=${encodeURIComponent(cursor)}&limit=30`
        : `/api/trips/${tripId}/history?limit=30`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch history')
      const data = await res.json() as { entries: TripHistoryEntry[]; hasMore: boolean; nextCursor: string | null }
      if (cursor) {
        setEntries(prev => [...prev, ...data.entries])
      } else {
        setEntries(data.entries)
      }
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    } catch (err) {
      console.error('Error fetching history:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [tripId])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  async function handleRestore(historyId: string) {
    setRestoring(historyId)
    try {
      const res = await fetch(`/api/trips/${tripId}/history/${historyId}/restore`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        alert(data.error || '復元に失敗しました')
        return
      }
      onRestored()
    } catch (err) {
      console.error('Restore error:', err)
      alert('復元に失敗しました')
    } finally {
      setRestoring(null)
      setConfirmRestore(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="history-modal-title">
            <HistoryIcon size={16} /> 変更履歴
          </h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="history-empty">読み込み中...</div>
        ) : entries.length === 0 ? (
          <div className="history-empty">変更履歴はまだありません</div>
        ) : (
          <>
            <ul className="history-timeline" ref={listRef}>
              {entries.map((entry) => (
                <li key={entry.id} className="history-entry">
                  <div
                    className="history-action-icon"
                    style={{ color: actionColor(entry.action) }}
                  >
                    {actionIcon(entry.action)}
                  </div>
                  <div className="history-content">
                    <div className="history-header">
                      <span className="history-user">
                        {entry.userName || '不明なユーザー'}
                      </span>
                      <span className="history-time">
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className="history-summary">{entry.summary}</div>
                    {entry.hasSnapshot && isOwner && (
                      <>
                        {confirmRestore === entry.id ? (
                          <div className="history-restore-confirm">
                            <p className="history-restore-warning">
                              この時点の状態に復元しますか？
                              <br />
                              <small>現在の内容は変更履歴に保存されます。</small>
                            </p>
                            <div className="history-restore-actions">
                              <button
                                className="btn-outline btn-sm"
                                onClick={() => setConfirmRestore(null)}
                                disabled={restoring === entry.id}
                              >
                                キャンセル
                              </button>
                              <button
                                className="btn-filled btn-sm"
                                onClick={() => handleRestore(entry.id)}
                                disabled={restoring === entry.id}
                              >
                                {restoring === entry.id ? '復元中...' : '復元する'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="history-restore-btn"
                            onClick={() => setConfirmRestore(entry.id)}
                          >
                            この時点に復元
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="history-load-more">
                <button
                  className="btn-outline btn-sm"
                  onClick={() => fetchHistory(nextCursor)}
                  disabled={loadingMore}
                >
                  {loadingMore ? '読み込み中...' : 'もっと見る'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
