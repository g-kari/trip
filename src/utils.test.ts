import { describe, it, expect } from 'vitest'
import {
  formatDateRange,
  formatCost,
  formatDayDate,
  formatDayLabel,
  generateMapUrl,
} from './utils'

describe('formatDateRange', () => {
  it('formats a valid date range', () => {
    const result = formatDateRange('2024-03-15', '2024-03-20')
    expect(result).toBe('3/15 – 3/20')
  })

  it('handles dates spanning different months', () => {
    const result = formatDateRange('2024-01-28', '2024-02-03')
    expect(result).toBe('1/28 – 2/3')
  })

  it('returns empty string when start is null', () => {
    const result = formatDateRange(null, '2024-03-20')
    expect(result).toBe('')
  })

  it('returns empty string when end is null', () => {
    const result = formatDateRange('2024-03-15', null)
    expect(result).toBe('')
  })

  it('returns empty string when both are null', () => {
    const result = formatDateRange(null, null)
    expect(result).toBe('')
  })
})

describe('formatCost', () => {
  it('formats cost with yen symbol', () => {
    const result = formatCost(1500)
    expect(result).toBe('¥1,500')
  })

  it('formats zero cost', () => {
    const result = formatCost(0)
    expect(result).toBe('¥0')
  })

  it('formats large numbers with proper separators', () => {
    const result = formatCost(1234567)
    expect(result).toBe('¥1,234,567')
  })

  it('formats small numbers without separators', () => {
    const result = formatCost(100)
    expect(result).toBe('¥100')
  })
})

describe('formatDayDate', () => {
  it('formats date with day of week in Japanese', () => {
    // 2024-03-15 is a Friday
    const result = formatDayDate('2024-03-15')
    expect(result).toBe('3/15 (金)')
  })

  it('formats a Sunday correctly', () => {
    // 2024-03-17 is a Sunday
    const result = formatDayDate('2024-03-17')
    expect(result).toBe('3/17 (日)')
  })

  it('formats a Monday correctly', () => {
    // 2024-03-18 is a Monday
    const result = formatDayDate('2024-03-18')
    expect(result).toBe('3/18 (月)')
  })

  it('formats dates in December correctly', () => {
    // 2024-12-25 is a Wednesday
    const result = formatDayDate('2024-12-25')
    expect(result).toBe('12/25 (水)')
  })
})

describe('formatDayLabel', () => {
  it('returns label and dateStr for first day', () => {
    const result = formatDayLabel('2024-03-15', 0)
    expect(result.label).toBe('Day 1')
    expect(result.dateStr).toBe('3/15 (金)')
  })

  it('returns label and dateStr for subsequent days', () => {
    const result = formatDayLabel('2024-03-16', 1)
    expect(result.label).toBe('Day 2')
    expect(result.dateStr).toBe('3/16 (土)')
  })

  it('handles double-digit day numbers', () => {
    const result = formatDayLabel('2024-03-25', 9)
    expect(result.label).toBe('Day 10')
    expect(result.dateStr).toBe('3/25 (月)')
  })
})

describe('generateMapUrl', () => {
  it('generates URL with title only', () => {
    const result = generateMapUrl('Tokyo Tower')
    expect(result).toBe('https://www.google.com/maps/search/?api=1&query=Tokyo%20Tower')
  })

  it('generates URL with title and area', () => {
    const result = generateMapUrl('Sensoji Temple', 'Asakusa')
    expect(result).toBe('https://www.google.com/maps/search/?api=1&query=Sensoji%20Temple%20Asakusa')
  })

  it('encodes special characters properly', () => {
    const result = generateMapUrl('Cafe & Bar')
    expect(result).toBe('https://www.google.com/maps/search/?api=1&query=Cafe%20%26%20Bar')
  })

  it('handles empty area as undefined', () => {
    const result = generateMapUrl('Place Name', undefined)
    expect(result).toBe('https://www.google.com/maps/search/?api=1&query=Place%20Name')
  })
})
