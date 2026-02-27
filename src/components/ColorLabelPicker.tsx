import type { ColorLabel } from '../types'
import { COLOR_LABELS, COLOR_LABEL_NAMES } from '../types'


type ColorLabelPickerProps = {
  value: ColorLabel | null
  onChange: (color: ColorLabel | null) => void
  disabled?: boolean
}

export function ColorLabelPicker({ value, onChange, disabled }: ColorLabelPickerProps) {
  return (
    <div className="color-label-picker">
      <button
        type="button"
        className={`color-label-btn color-label-btn-none ${value === null ? 'active' : ''}`}
        onClick={() => onChange(null)}
        disabled={disabled}
        title="なし"
        aria-label="カラーラベルなし"
      >
        <span className="color-label-none-icon">-</span>
      </button>
      {COLOR_LABELS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-label-btn color-label-btn-${color} ${value === color ? 'active' : ''}`}
          onClick={() => onChange(color)}
          disabled={disabled}
          title={COLOR_LABEL_NAMES[color]}
          aria-label={COLOR_LABEL_NAMES[color]}
        >
          {value === color && <span className="color-label-check">&#10003;</span>}
        </button>
      ))}
    </div>
  )
}

// Small filter version for TripListPage
type ColorLabelFilterProps = {
  value: ColorLabel | ''
  onChange: (color: ColorLabel | '') => void
}

export function ColorLabelFilter({ value, onChange }: ColorLabelFilterProps) {
  return (
    <div className="color-label-filter">
      <button
        type="button"
        className={`color-filter-btn color-filter-btn-all ${value === '' ? 'active' : ''}`}
        onClick={() => onChange('')}
        title="すべて"
      >
        <span className="color-filter-all-text">ALL</span>
      </button>
      {COLOR_LABELS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-filter-btn color-filter-btn-${color} ${value === color ? 'active' : ''}`}
          onClick={() => onChange(color)}
          title={COLOR_LABEL_NAMES[color]}
        />
      ))}
    </div>
  )
}

// Color indicator for trip cards
type ColorLabelIndicatorProps = {
  color: ColorLabel | null
}

export function ColorLabelIndicator({ color }: ColorLabelIndicatorProps) {
  if (!color) return null
  return <div className={`color-label-indicator color-label-indicator-${color}`} />
}
