import { useState } from 'react'
import { OptimizeModal } from './OptimizeModal'
import { RouteIcon } from './Icons'
import type { Item, Day } from '../types'

type OptimizeButtonProps = {
  tripId: string
  day: Day
  items: Item[]
  onOptimized: () => void
  isOwner: boolean
}

export function OptimizeButton({ tripId, day, items, onOptimized, isOwner }: OptimizeButtonProps) {
  const [showModal, setShowModal] = useState(false)

  // Only show if user is owner/editor and there are at least 2 items
  if (!isOwner || items.length < 2) {
    return null
  }

  return (
    <>
      <button
        className="btn-icon no-print"
        onClick={() => setShowModal(true)}
        title="ルート最適化"
      >
        <RouteIcon size={14} />
      </button>
      {showModal && (
        <OptimizeModal
          tripId={tripId}
          dayId={day.id}
          items={items}
          onClose={() => setShowModal(false)}
          onApplied={() => {
            setShowModal(false)
            onOptimized()
          }}
        />
      )}
    </>
  )
}
