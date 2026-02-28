import { useState } from 'react'

export function StarRating({ rating, onRate, readonly = false }: {
  rating: number
  onRate?: (rating: number) => void
  readonly?: boolean
}) {
  const [hoverRating, setHoverRating] = useState(0)

  return (
    <div className="star-rating" onMouseLeave={() => setHoverRating(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`star-btn ${readonly ? 'readonly' : ''}`}
          onClick={() => !readonly && onRate?.(star)}
          onMouseEnter={() => !readonly && setHoverRating(star)}
          disabled={readonly}
        >
          <span className={`star ${(hoverRating || rating) >= star ? 'filled' : ''}`}>
            {(hoverRating || rating) >= star ? '\u2605' : '\u2606'}
          </span>
        </button>
      ))}
    </div>
  )
}
