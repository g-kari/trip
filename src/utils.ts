import type { BudgetSummary, CostCategory, Item } from './types'
import { COST_CATEGORIES } from './types'

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(s)} – ${fmt(e)}`
}

export function formatCost(cost: number): string {
  return `¥${cost.toLocaleString()}`
}

export function formatDayLabel(date: string, index: number): { label: string; dateStr: string } {
  const d = new Date(date)
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const dayOfWeek = days[d.getDay()]
  return {
    label: `Day ${index + 1}`,
    dateStr: `${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`,
  }
}

export function formatDayDate(date: string): string {
  const d = new Date(date)
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const dayOfWeek = days[d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`
}

// Check if a date string matches today (JST)
export function isDayToday(dateStr: string): boolean {
  const now = new Date()
  const jstOffset = 9 * 60 * 60 * 1000
  const jstNow = new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60 * 1000)
  const today = jstNow.toISOString().split('T')[0]
  return dateStr === today
}

// Calculate budget summary from items and budget
export function getBudgetSummary(items: Item[], budget: number | null): BudgetSummary {
  const totalSpent = items.reduce((sum, item) => sum + (item.cost || 0), 0)

  const categoryTotals = new Map<CostCategory, number>()
  for (const cat of COST_CATEGORIES) {
    categoryTotals.set(cat, 0)
  }

  for (const item of items) {
    if (item.cost && item.cost > 0) {
      const category = (item.costCategory || 'その他') as CostCategory
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + item.cost)
    }
  }

  const byCategory = COST_CATEGORIES
    .map((category) => ({
      category,
      amount: categoryTotals.get(category) || 0,
      percentage: totalSpent > 0 ? Math.round(((categoryTotals.get(category) || 0) / totalSpent) * 100) : 0,
    }))
    .filter((c) => c.amount > 0)

  return {
    totalBudget: budget,
    totalSpent,
    remaining: budget ? budget - totalSpent : null,
    isOverBudget: budget ? totalSpent > budget : false,
    byCategory,
  }
}

// Generate Google Maps search URL from title and area
export function generateMapUrl(title: string, area?: string): string {
  const query = area ? `${title} ${area}` : title
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
