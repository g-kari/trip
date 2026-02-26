import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { COST_CATEGORIES } from '../types'
import type { CostCategory } from '../types'

type Stats = {
  totalTrips: number
  totalDays: number
  totalCost: number
  costByCategory: { category: string; amount: number }[]
  tripsByTheme: { theme: string; count: number }[]
  tripsByMonth: { month: string; count: number }[]
  averageCostPerTrip: number
  averageDaysPerTrip: number
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('ja-JP')
}

function formatMonth(month: string): string {
  const [year, monthNum] = month.split('-')
  return `${year}/${monthNum}`
}

function getThemeLabel(theme: string): string {
  return theme === 'photo' ? '写真映え' : 'しずか'
}

// Get color for category bar
function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    '交通費': 'var(--stats-color-transport)',
    '宿泊費': 'var(--stats-color-lodging)',
    '食費': 'var(--stats-color-food)',
    '観光・アクティビティ': 'var(--stats-color-activity)',
    'お土産': 'var(--stats-color-souvenir)',
    'その他': 'var(--stats-color-other)',
  }
  return colors[category] || 'var(--color-text-faint)'
}

export function StatsPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showError } = useToast()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      navigate('/login')
      return
    }

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats')
        if (!res.ok) {
          if (res.status === 401) {
            navigate('/login')
            return
          }
          showError('統計の読み込みに失敗しました')
          return
        }
        const data = (await res.json()) as Stats
        setStats(data)
      } catch (err) {
        console.error('Failed to fetch stats:', err)
        showError('ネットワークエラーが発生しました')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [authLoading, user, navigate, showError])

  if (loading || authLoading) {
    return (
      <div className="stats-section">
        <div className="section-header">
          <span className="section-title">統計</span>
        </div>
        <div className="stats-loading">
          <div className="skeleton stats-summary-skeleton" />
          <div className="skeleton stats-chart-skeleton" />
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="stats-section">
        <div className="section-header">
          <span className="section-title">統計</span>
        </div>
        <div className="empty-state">
          <p className="empty-state-text">統計を読み込めませんでした</p>
        </div>
      </div>
    )
  }

  const maxCategoryCost = Math.max(...stats.costByCategory.map(c => c.amount), 1)
  const maxMonthlyTrips = Math.max(...stats.tripsByMonth.map(m => m.count), 1)

  // Fill in missing categories with 0
  const allCategoryStats = COST_CATEGORIES.map((category: CostCategory) => {
    const found = stats.costByCategory.find(c => c.category === category)
    return {
      category,
      amount: found?.amount ?? 0,
    }
  })

  return (
    <div className="stats-section">
      <div className="section-header">
        <span className="section-title">統計</span>
      </div>

      {/* Summary Cards */}
      <div className="stats-summary">
        <div className="stats-card">
          <span className="stats-card-label">旅程数</span>
          <span className="stats-card-value">{stats.totalTrips}</span>
          <span className="stats-card-unit">回</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">総日数</span>
          <span className="stats-card-value">{stats.totalDays}</span>
          <span className="stats-card-unit">日</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">総費用</span>
          <span className="stats-card-value">{formatCurrency(stats.totalCost)}</span>
          <span className="stats-card-unit">円</span>
        </div>
      </div>

      {/* Average Cards */}
      <div className="stats-averages">
        <div className="stats-average-item">
          <span className="stats-average-label">旅程あたり平均費用</span>
          <span className="stats-average-value">{formatCurrency(stats.averageCostPerTrip)} 円</span>
        </div>
        <div className="stats-average-item">
          <span className="stats-average-label">旅程あたり平均日数</span>
          <span className="stats-average-value">{stats.averageDaysPerTrip} 日</span>
        </div>
      </div>

      {/* Cost by Category */}
      <div className="stats-chart-section">
        <h3 className="stats-chart-title">カテゴリ別費用</h3>
        {stats.costByCategory.length === 0 ? (
          <p className="stats-empty">まだ費用が登録されていません</p>
        ) : (
          <div className="stats-bar-chart">
            {allCategoryStats.map(({ category, amount }) => (
              <div key={category} className="stats-bar-row">
                <span className="stats-bar-label">{category}</span>
                <div className="stats-bar-wrapper">
                  <div
                    className="stats-bar"
                    style={{
                      width: `${(amount / maxCategoryCost) * 100}%`,
                      backgroundColor: getCategoryColor(category),
                    }}
                  />
                </div>
                <span className="stats-bar-value">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trips by Theme */}
      <div className="stats-chart-section">
        <h3 className="stats-chart-title">テーマ別旅程数</h3>
        {stats.tripsByTheme.length === 0 ? (
          <p className="stats-empty">まだ旅程がありません</p>
        ) : (
          <div className="stats-theme-list">
            {stats.tripsByTheme.map(({ theme, count }) => (
              <div key={theme} className="stats-theme-item">
                <span className={`stats-theme-badge stats-theme-${theme}`}>
                  {getThemeLabel(theme)}
                </span>
                <span className="stats-theme-count">{count} 回</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trips by Month */}
      <div className="stats-chart-section">
        <h3 className="stats-chart-title">月別旅程数（過去12ヶ月）</h3>
        {stats.tripsByMonth.length === 0 ? (
          <p className="stats-empty">該当するデータがありません</p>
        ) : (
          <div className="stats-monthly-chart">
            {stats.tripsByMonth.map(({ month, count }) => (
              <div key={month} className="stats-monthly-bar">
                <div className="stats-monthly-bar-wrapper">
                  <div
                    className="stats-monthly-bar-fill"
                    style={{
                      height: `${(count / maxMonthlyTrips) * 100}%`,
                    }}
                  />
                </div>
                <span className="stats-monthly-count">{count}</span>
                <span className="stats-monthly-label">{formatMonth(month)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
