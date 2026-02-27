import { useState, useEffect, useCallback } from 'react'

type PackingItem = {
  id: string
  trip_id: string
  name: string
  category: string
  is_checked: number
  sort: number
  created_at: string
  updated_at: string
}

type PackingListProps = {
  tripId: string
  readOnly?: boolean
}

const DEFAULT_CATEGORIES = [
  '衣類',
  '洗面用品',
  '電子機器',
  '書類',
  '薬・衛生用品',
  'その他',
]

export function PackingList({ tripId, readOnly = false }: PackingListProps) {
  const [items, setItems] = useState<PackingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newItemName, setNewItemName] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('その他')
  const [isAdding, setIsAdding] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(DEFAULT_CATEGORIES))

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/packing`)
      if (res.ok) {
        const data = await res.json() as { items: PackingItem[] }
        setItems(data.items)
      }
    } catch (err) {
      console.error('Failed to fetch packing items:', err)
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemName.trim() || isAdding) return

    setIsAdding(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/packing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newItemName.trim(), category: newItemCategory }),
      })
      if (res.ok) {
        const data = await res.json() as { item: PackingItem }
        setItems(prev => [...prev, data.item])
        setNewItemName('')
        // Ensure the category is expanded
        setExpandedCategories(prev => new Set([...prev, newItemCategory]))
      }
    } catch (err) {
      console.error('Failed to add item:', err)
    } finally {
      setIsAdding(false)
    }
  }

  const toggleCheck = async (item: PackingItem) => {
    if (readOnly) return

    const newChecked = !item.is_checked
    // Optimistic update
    setItems(prev =>
      prev.map(i => (i.id === item.id ? { ...i, is_checked: newChecked ? 1 : 0 } : i))
    )

    try {
      await fetch(`/api/trips/${tripId}/packing/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_checked: newChecked }),
      })
    } catch (err) {
      console.error('Failed to toggle item:', err)
      // Revert on error
      setItems(prev =>
        prev.map(i => (i.id === item.id ? { ...i, is_checked: item.is_checked } : i))
      )
    }
  }

  const deleteItem = async (itemId: string) => {
    if (readOnly) return

    // Optimistic update
    setItems(prev => prev.filter(i => i.id !== itemId))

    try {
      await fetch(`/api/trips/${tripId}/packing/${itemId}`, {
        method: 'DELETE',
      })
    } catch (err) {
      console.error('Failed to delete item:', err)
      fetchItems() // Refetch on error
    }
  }

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  // Group items by category
  const itemsByCategory = items.reduce((acc, item) => {
    const cat = item.category || 'その他'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, PackingItem[]>)

  // Get all categories (default + any custom ones)
  const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...Object.keys(itemsByCategory)])]

  // Calculate progress
  const totalItems = items.length
  const checkedItems = items.filter(i => i.is_checked).length
  const progress = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0

  if (loading) {
    return (
      <div className="packing-list-section">
        <div className="packing-list-loading">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="packing-list-section">
      {totalItems > 0 && (
        <div className="packing-list-header">
          <span className="packing-list-progress">
            {checkedItems}/{totalItems} 完了（{progress}%）
          </span>
        </div>
      )}

      {totalItems > 0 && (
        <div className="packing-progress-bar">
          <div
            className="packing-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {!readOnly && (
        <form className="packing-add-form" onSubmit={addItem}>
          <select
            className="packing-category-select"
            value={newItemCategory}
            onChange={e => setNewItemCategory(e.target.value)}
          >
            {DEFAULT_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <input
            type="text"
            className="packing-add-input"
            placeholder="持ち物を追加..."
            value={newItemName}
            onChange={e => setNewItemName(e.target.value)}
          />
          <button
            type="submit"
            className="packing-add-btn"
            disabled={!newItemName.trim() || isAdding}
          >
            追加
          </button>
        </form>
      )}

      {totalItems === 0 ? (
        <div className="packing-empty">
          まだ持ち物が登録されていません
        </div>
      ) : (
        <div className="packing-categories">
          {allCategories.map(category => {
            const categoryItems = itemsByCategory[category] || []
            if (categoryItems.length === 0) return null

            const isExpanded = expandedCategories.has(category)
            const categoryChecked = categoryItems.filter(i => i.is_checked).length
            const categoryTotal = categoryItems.length

            return (
              <div key={category} className="packing-category">
                <button
                  className="packing-category-header"
                  onClick={() => toggleCategory(category)}
                >
                  <span className="packing-category-toggle">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="packing-category-name">{category}</span>
                  <span className="packing-category-count">
                    {categoryChecked}/{categoryTotal}
                  </span>
                </button>

                {isExpanded && (
                  <ul className="packing-items">
                    {categoryItems
                      .sort((a, b) => a.sort - b.sort)
                      .map(item => (
                        <li
                          key={item.id}
                          className={`packing-item ${item.is_checked ? 'checked' : ''}`}
                        >
                          <label className="packing-item-label">
                            <input
                              type="checkbox"
                              className="packing-item-checkbox"
                              checked={!!item.is_checked}
                              onChange={() => toggleCheck(item)}
                              disabled={readOnly}
                            />
                            <span className="packing-item-name">{item.name}</span>
                          </label>
                          {!readOnly && (
                            <button
                              className="packing-item-delete"
                              onClick={() => deleteItem(item.id)}
                              aria-label="削除"
                            >
                              ×
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
