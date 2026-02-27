import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CompareIcon, XIcon } from './Icons'
import type { Trip } from '../types'

type CompareSelectionBarProps = {
  selectedTrips: Trip[]
  onRemove: (tripId: string) => void
  onClear: () => void
}

export function CompareSelectionBar({ selectedTrips, onRemove, onClear }: CompareSelectionBarProps) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (selectedTrips.length === 0) {
    return null
  }

  const canCompare = selectedTrips.length >= 2 && selectedTrips.length <= 4

  async function handleCompare() {
    if (!canCompare) return

    setCreating(true)
    setError(null)

    try {
      const res = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '旅程比較',
          tripIds: selectedTrips.map(t => t.id),
          labels: selectedTrips.map((_, i) => `プラン${String.fromCharCode(65 + i)}`),
        }),
      })

      const data = await res.json() as { groupId?: string; error?: string }

      if (!res.ok) {
        setError(data.error || '比較グループの作成に失敗しました')
        return
      }

      if (data.groupId) {
        onClear()
        navigate(`/compare/${data.groupId}`)
      }
    } catch (err) {
      console.error('Failed to create comparison:', err)
      setError('比較グループの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="compare-selection-bar">
      <div className="compare-selection-bar-content">
        <div className="compare-selection-info">
          <CompareIcon size={20} />
          <span className="compare-selection-count">
            {selectedTrips.length}件選択中
          </span>
          {selectedTrips.length < 2 && (
            <span className="compare-selection-hint">
              (2件以上選択してください)
            </span>
          )}
        </div>

        <div className="compare-selection-trips">
          {selectedTrips.map(trip => (
            <div key={trip.id} className="compare-selection-trip">
              <span className="compare-selection-trip-title">{trip.title}</span>
              <button
                type="button"
                className="compare-selection-trip-remove"
                onClick={() => onRemove(trip.id)}
                aria-label={`${trip.title}を選択解除`}
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>

        {error && (
          <div className="compare-selection-error">{error}</div>
        )}

        <div className="compare-selection-actions">
          <button
            type="button"
            className="btn-text"
            onClick={onClear}
          >
            選択解除
          </button>
          <button
            type="button"
            className="btn-filled"
            onClick={handleCompare}
            disabled={!canCompare || creating}
          >
            {creating ? '作成中...' : '比較する'}
          </button>
        </div>
      </div>
    </div>
  )
}
