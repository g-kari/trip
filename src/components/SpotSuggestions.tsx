import { useState } from 'react'
import type { Item, CostCategory } from '../types'
import { generateMapUrl } from '../utils'
import { useEscapeKey } from '../hooks/useEscapeKey'

// Suggestion type from AI
export type SpotSuggestion = {
  name: string
  area: string | null
  description: string
  category: 'restaurant' | 'cafe' | 'attraction' | 'shop' | 'other'
  estimatedCost: number | null
}

// Map category to cost category
function mapCategoryToCostCategory(category: SpotSuggestion['category']): CostCategory | null {
  switch (category) {
    case 'restaurant':
    case 'cafe':
      return '食費'
    case 'attraction':
      return '観光・アクティビティ'
    case 'shop':
      return 'お土産'
    default:
      return null
  }
}

// Category labels in Japanese
const CATEGORY_LABELS: Record<SpotSuggestion['category'], string> = {
  restaurant: 'レストラン',
  cafe: 'カフェ',
  attraction: '観光',
  shop: 'ショップ',
  other: 'その他',
}

type SpotSuggestionsProps = {
  tripId: string
  item: Item
  dayId: string
  onClose: () => void
  onAddSpot: (suggestion: SpotSuggestion) => void
}

export function SpotSuggestions({ tripId, item, dayId, onClose, onAddSpot }: SpotSuggestionsProps) {
  useEscapeKey(onClose)
  const [suggestions, setSuggestions] = useState<SpotSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [addingIndex, setAddingIndex] = useState<number | null>(null)

  async function fetchSuggestions() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/trips/${tripId}/items/${item.id}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await res.json() as {
        suggestions?: SpotSuggestion[]
        error?: string
        remaining?: number
        limitReached?: boolean
      }

      if (!res.ok) {
        if (data.limitReached) {
          setError('AIクレジットが不足しています\n毎月1日にリセットされます')
        } else {
          setError(data.error || '周辺スポットの取得に失敗しました')
        }
        return
      }

      setSuggestions(data.suggestions || [])
      if (data.remaining !== undefined) {
        setRemaining(data.remaining)
      }
    } catch (err) {
      console.error('Failed to fetch suggestions:', err)
      setError('周辺スポットの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function addSpotToItinerary(suggestion: SpotSuggestion, index: number) {
    setAddingIndex(index)
    try {
      const mapUrl = generateMapUrl(suggestion.name, suggestion.area || undefined)
      const costCategory = mapCategoryToCostCategory(suggestion.category)

      const res = await fetch(`/api/trips/${tripId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayId,
          title: suggestion.name,
          area: suggestion.area || undefined,
          note: suggestion.description || undefined,
          cost: suggestion.estimatedCost || undefined,
          costCategory: costCategory || undefined,
          mapUrl,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error || '追加に失敗しました')
      }

      onAddSpot(suggestion)
    } catch (err) {
      console.error('Failed to add spot:', err)
      setError('スポットの追加に失敗しました')
    } finally {
      setAddingIndex(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal spot-suggestions-modal" role="dialog" aria-modal="true" aria-labelledby="spot-suggestions-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" id="spot-suggestions-modal-title">周辺スポット</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="spot-suggestions-source">
            <span className="spot-suggestions-source-label">基準スポット:</span>
            <span className="spot-suggestions-source-name">{item.title}</span>
            {item.area && <span className="spot-suggestions-source-area">({item.area})</span>}
          </div>

          {!loading && suggestions.length === 0 && !error && (
            <div className="spot-suggestions-empty">
              <p>「{item.title}」の近くにあるおすすめスポットをAIが提案します。</p>
              <button
                className="btn-filled"
                onClick={fetchSuggestions}
              >
                周辺スポットを提案（1クレジット）
              </button>
              {remaining !== null && remaining < 3 && (
                <p className="spot-suggestions-remaining">
                  残りクレジット: {remaining}
                </p>
              )}
            </div>
          )}

          {loading && (
            <div className="spot-suggestions-loading">
              <div className="spot-suggestions-spinner" />
              <p>周辺スポットを検索中...</p>
            </div>
          )}

          {error && (
            <div className="spot-suggestions-error">
              {error.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <button className="btn-text" onClick={() => setError(null)}>
                戻る
              </button>
            </div>
          )}

          {!loading && suggestions.length > 0 && (
            <div className="spot-suggestions-list">
              {remaining !== null && (
                <p className="spot-suggestions-remaining">
                  残りクレジット: {remaining}
                </p>
              )}
              {suggestions.map((suggestion, index) => (
                <div key={index} className="spot-suggestion-item">
                  <div className="spot-suggestion-header">
                    <span className="spot-suggestion-name">{suggestion.name}</span>
                    <span className={`spot-suggestion-category spot-suggestion-category-${suggestion.category}`}>
                      {CATEGORY_LABELS[suggestion.category]}
                    </span>
                  </div>
                  {suggestion.area && (
                    <span className="spot-suggestion-area">{suggestion.area}</span>
                  )}
                  <p className="spot-suggestion-description">{suggestion.description}</p>
                  {suggestion.estimatedCost !== null && suggestion.estimatedCost > 0 && (
                    <span className="spot-suggestion-cost">
                      約{suggestion.estimatedCost.toLocaleString()}円
                    </span>
                  )}
                  <button
                    className="btn-outline spot-suggestion-add"
                    onClick={() => addSpotToItinerary(suggestion, index)}
                    disabled={addingIndex !== null}
                  >
                    {addingIndex === index ? '追加中...' : '+ 旅程に追加'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
