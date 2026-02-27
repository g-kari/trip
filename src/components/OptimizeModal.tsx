import { useState } from 'react'
import type { Item } from '../types'

// Type for optimized item from API
type OptimizedItem = {
  id: string
  title: string
  area: string | null
  timeStart: string | null
  reason: string
}

// Type for original item (subset)
type OriginalItem = {
  id: string
  title: string
  area: string | null
}

type OptimizeModalProps = {
  tripId: string
  dayId: string
  items: Item[]
  onClose: () => void
  onApplied: () => void
}

export function OptimizeModal({ tripId, dayId, items, onClose, onApplied }: OptimizeModalProps) {
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originalOrder, setOriginalOrder] = useState<OriginalItem[]>([])
  const [optimizedOrder, setOptimizedOrder] = useState<OptimizedItem[]>([])
  const [totalSavings, setTotalSavings] = useState<string>('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [hasOptimized, setHasOptimized] = useState(false)

  async function fetchOptimization() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await res.json() as {
        originalOrder?: OriginalItem[]
        optimizedOrder?: OptimizedItem[]
        totalSavings?: string
        warnings?: string[]
        remaining?: number
        error?: string
        limitReached?: boolean
      }

      if (!res.ok) {
        if (data.limitReached) {
          setError(data.error || '利用上限に達しました')
        } else {
          setError(data.error || 'ルートの最適化に失敗しました')
        }
        return
      }

      setOriginalOrder(data.originalOrder || [])
      setOptimizedOrder(data.optimizedOrder || [])
      setTotalSavings(data.totalSavings || '')
      setWarnings(data.warnings || [])
      if (data.remaining !== undefined) {
        setRemaining(data.remaining)
      }
      setHasOptimized(true)
    } catch (err) {
      console.error('Failed to fetch optimization:', err)
      setError('ルートの最適化に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function applyOptimization() {
    setApplying(true)
    setError(null)

    try {
      const itemIds = optimizedOrder.map(item => item.id)
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/apply-optimization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error || '順序の適用に失敗しました')
        return
      }

      onApplied()
    } catch (err) {
      console.error('Failed to apply optimization:', err)
      setError('順序の適用に失敗しました')
    } finally {
      setApplying(false)
    }
  }

  // Check if the order has changed
  function hasOrderChanged(): boolean {
    if (originalOrder.length !== optimizedOrder.length) return true
    for (let i = 0; i < originalOrder.length; i++) {
      if (originalOrder[i].id !== optimizedOrder[i].id) {
        return true
      }
    }
    return false
  }

  // Get the original position of an item (1-based)
  function getOriginalPosition(itemId: string): number {
    return originalOrder.findIndex(item => item.id === itemId) + 1
  }

  // Check if item has moved
  function hasItemMoved(itemId: string, newIndex: number): boolean {
    const originalIndex = originalOrder.findIndex(item => item.id === itemId)
    return originalIndex !== newIndex
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal optimize-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">ルート最適化</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Initial state - show button to start optimization */}
          {!loading && !hasOptimized && !error && (
            <div className="optimize-empty">
              <p>AIが移動時間を考慮して、効率的なルート順序を提案します。</p>
              <p className="optimize-empty-note">
                {items.length}件のスポットを分析します
              </p>
              <button
                className="btn-filled"
                onClick={fetchOptimization}
              >
                ルートを最適化
              </button>
              {remaining !== null && remaining < 3 && (
                <p className="optimize-remaining">
                  本日の残り利用回数: {remaining}回
                </p>
              )}
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="optimize-loading">
              <div className="optimize-spinner" />
              <p>AIが最適なルートを計算中...</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="optimize-error">
              <p>{error}</p>
              <button className="btn-text" onClick={() => setError(null)}>
                戻る
              </button>
            </div>
          )}

          {/* Results state */}
          {!loading && hasOptimized && !error && (
            <div className="optimize-results">
              {remaining !== null && (
                <p className="optimize-remaining">
                  本日の残り利用回数: {remaining}回
                </p>
              )}

              {/* Savings summary */}
              {totalSavings && (
                <div className="optimize-savings">
                  <span className="optimize-savings-icon">✓</span>
                  <span className="optimize-savings-text">{totalSavings}</span>
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="optimize-warnings">
                  {warnings.map((warning, index) => (
                    <p key={index} className="optimize-warning">
                      ⚠ {warning}
                    </p>
                  ))}
                </div>
              )}

              {/* Comparison view */}
              <div className="optimize-comparison">
                <div className="optimize-column">
                  <h4 className="optimize-column-title">現在の順序</h4>
                  <div className="optimize-list">
                    {originalOrder.map((item, index) => (
                      <div key={item.id} className="optimize-item">
                        <span className="optimize-item-number">{index + 1}</span>
                        <div className="optimize-item-content">
                          <span className="optimize-item-title">{item.title}</span>
                          {item.area && (
                            <span className="optimize-item-area">{item.area}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="optimize-arrow">→</div>

                <div className="optimize-column">
                  <h4 className="optimize-column-title">最適化後</h4>
                  <div className="optimize-list">
                    {optimizedOrder.map((item, index) => {
                      const moved = hasItemMoved(item.id, index)
                      const originalPos = getOriginalPosition(item.id)
                      return (
                        <div
                          key={item.id}
                          className={`optimize-item ${moved ? 'moved' : ''}`}
                        >
                          <span className="optimize-item-number">{index + 1}</span>
                          <div className="optimize-item-content">
                            <span className="optimize-item-title">
                              {item.title}
                              {moved && (
                                <span className="optimize-item-moved-badge">
                                  {originalPos}番目から移動
                                </span>
                              )}
                            </span>
                            {item.area && (
                              <span className="optimize-item-area">{item.area}</span>
                            )}
                            {item.reason && (
                              <span className="optimize-item-reason">{item.reason}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="optimize-actions">
                {hasOrderChanged() ? (
                  <>
                    <button
                      className="btn-outline"
                      onClick={onClose}
                      disabled={applying}
                    >
                      キャンセル
                    </button>
                    <button
                      className="btn-filled"
                      onClick={applyOptimization}
                      disabled={applying}
                    >
                      {applying ? '適用中...' : 'この順序を適用する'}
                    </button>
                  </>
                ) : (
                  <div className="optimize-no-change">
                    <p>現在の順序が最適です</p>
                    <button className="btn-outline" onClick={onClose}>
                      閉じる
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
