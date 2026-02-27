import { useState } from 'react'
import type { Item, ItemInsights as ItemInsightsType } from '../types'

type ItemInsightsProps = {
  tripId: string
  item: Item
  editable?: boolean
  onInsightsUpdate?: (insights: ItemInsightsType | null) => void
}

export function ItemInsightsChips({ insights }: { insights: ItemInsightsType }) {
  const chips: { label: string; className: string }[] = []

  if (insights.genre) {
    chips.push({ label: insights.genre, className: 'insight-chip insight-chip-genre' })
  }
  if (insights.hours) {
    chips.push({ label: insights.hours, className: 'insight-chip insight-chip-hours' })
  }
  if (insights.priceRange) {
    chips.push({ label: insights.priceRange, className: 'insight-chip insight-chip-price' })
  }
  if (insights.rating) {
    chips.push({ label: insights.rating, className: 'insight-chip insight-chip-rating' })
  }
  if (insights.tip) {
    chips.push({ label: insights.tip, className: 'insight-chip insight-chip-tip' })
  }

  if (chips.length === 0) return null

  return (
    <div className="insight-chips">
      {chips.map((chip, i) => (
        <span key={i} className={chip.className}>{chip.label}</span>
      ))}
    </div>
  )
}

export function ItemInsightsButton({ tripId, item, editable, onInsightsUpdate }: ItemInsightsProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateInsights = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/trips/${tripId}/items/${item.id}/insights`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await res.json() as { insights?: ItemInsightsType; error?: string; limitReached?: boolean }

      if (!res.ok) {
        setError(data.error || 'エラーが発生しました')
        return
      }

      if (data.insights) {
        onInsightsUpdate?.(data.insights)
      }
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const deleteInsights = async () => {
    try {
      await fetch(`/api/trips/${tripId}/items/${item.id}/insights`, {
        method: 'DELETE',
        credentials: 'include',
      })
      onInsightsUpdate?.(null)
    } catch {
      // silent fail
    }
  }

  if (item.insights) {
    return (
      <div className="insight-chips-wrapper">
        <ItemInsightsChips insights={item.insights} />
        {editable && (
          <button
            type="button"
            className="insight-remove-btn"
            onClick={deleteInsights}
            title="AI解析を削除"
          >
            ×
          </button>
        )}
      </div>
    )
  }

  if (!editable) return null

  return (
    <div className="insight-generate">
      <button
        type="button"
        className="insight-generate-btn"
        onClick={generateInsights}
        disabled={loading}
      >
        {loading ? '解析中…' : '✦ AI解析'}
      </button>
      {error && <span className="insight-error">{error}</span>}
    </div>
  )
}
