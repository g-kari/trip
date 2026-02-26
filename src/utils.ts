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
