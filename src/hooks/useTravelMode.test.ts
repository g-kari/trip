import { describe, it, expect } from 'vitest'
import { formatCheckinTime } from './useTravelMode'

describe('formatCheckinTime', () => {
  it('returns empty string for null', () => {
    expect(formatCheckinTime(null)).toBe('')
  })

  it('formats ISO datetime to HH:MM', () => {
    const result = formatCheckinTime('2024-03-15T14:30:00.000Z')
    // Result depends on local timezone, just verify format
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })

  it('pads single-digit hours and minutes', () => {
    // Use a date where UTC time has single digits
    const result = formatCheckinTime('2024-01-01T01:05:00.000Z')
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })
})
