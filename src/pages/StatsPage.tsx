import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { COST_CATEGORIES } from '../types'
import type { CostCategory } from '../types'

type Stats = {
  totalTrips: number
  totalDays: number
  totalItems: number
  totalCost: number
  costByCategory: { category: string; amount: number }[]
  tripsByTheme: { theme: string; count: number }[]
  tripsByMonth: { month: string; count: number }[]
  visitedAreas: string[]
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
  switch (theme) {
    case 'photo': return '写真映え'
    case 'retro': return 'レトロ'
    default: return 'しずか'
  }
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

// Get icon/emoji for category (simple text-based)
function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    '交通費': '電車',
    '宿泊費': '宿',
    '食費': '食',
    '観光・アクティビティ': '観光',
    'お土産': '土産',
    'その他': '他',
  }
  return icons[category] || '他'
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

  const maxMonthlyTrips = Math.max(...stats.tripsByMonth.map(m => m.count), 1)

  // Fill in missing categories with 0
  const allCategoryStats = COST_CATEGORIES.map((category: CostCategory) => {
    const found = stats.costByCategory.find(c => c.category === category)
    return {
      category,
      amount: found?.amount ?? 0,
    }
  })

  // Calculate percentage for each category
  const categoryWithPercentage = allCategoryStats.map(c => ({
    ...c,
    percentage: stats.totalCost > 0 ? (c.amount / stats.totalCost) * 100 : 0,
  }))

  return (
    <div className="stats-section">
      <div className="section-header">
        <span className="section-title">統計</span>
      </div>

      {/* Hero Summary - Total Expense */}
      <div className="stats-hero">
        <div className="stats-hero-label">総費用</div>
        <div className="stats-hero-value">
          <span className="stats-hero-yen">¥</span>
          <span className="stats-hero-amount">{formatCurrency(stats.totalCost)}</span>
        </div>
        <div className="stats-hero-sub">
          {stats.totalTrips}回の旅程 / {stats.totalDays}日間
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="stats-metrics">
        <div className="stats-metric-card">
          <div className="stats-metric-icon">旅</div>
          <div className="stats-metric-content">
            <span className="stats-metric-value">{stats.totalTrips}</span>
            <span className="stats-metric-label">旅程数</span>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="stats-metric-icon">日</div>
          <div className="stats-metric-content">
            <span className="stats-metric-value">{stats.totalDays}</span>
            <span className="stats-metric-label">総日数</span>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="stats-metric-icon">地</div>
          <div className="stats-metric-content">
            <span className="stats-metric-value">{stats.visitedAreas.length}</span>
            <span className="stats-metric-label">訪問エリア</span>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="stats-metric-icon">項</div>
          <div className="stats-metric-content">
            <span className="stats-metric-value">{stats.totalItems}</span>
            <span className="stats-metric-label">総予定数</span>
          </div>
        </div>
      </div>

      {/* Cost by Category with Progress Bars */}
      <div className="stats-chart-section">
        <h3 className="stats-chart-title">カテゴリ別費用</h3>
        {stats.totalCost === 0 ? (
          <p className="stats-empty">まだ費用が登録されていません</p>
        ) : (
          <div className="stats-category-breakdown">
            {categoryWithPercentage.map(({ category, amount, percentage }) => (
              <div key={category} className="stats-category-item">
                <div className="stats-category-header">
                  <div className="stats-category-left">
                    <span
                      className="stats-category-icon"
                      style={{ backgroundColor: getCategoryColor(category) }}
                    >
                      {getCategoryIcon(category)}
                    </span>
                    <span className="stats-category-name">{category}</span>
                  </div>
                  <div className="stats-category-right">
                    <span className="stats-category-amount">¥{formatCurrency(amount)}</span>
                    <span className="stats-category-percent">{percentage.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="stats-progress-bar">
                  <div
                    className="stats-progress-fill"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: getCategoryColor(category),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Average Stats */}
      <div className="stats-averages-section">
        <h3 className="stats-chart-title">平均値</h3>
        <div className="stats-average-grid">
          <div className="stats-average-card">
            <div className="stats-average-value">¥{formatCurrency(stats.averageCostPerTrip)}</div>
            <div className="stats-average-label">旅程あたり平均費用</div>
          </div>
          <div className="stats-average-card">
            <div className="stats-average-value">{stats.averageDaysPerTrip}日</div>
            <div className="stats-average-label">旅程あたり平均日数</div>
          </div>
        </div>
      </div>

      {/* Visited Areas */}
      <div className="stats-chart-section">
        <h3 className="stats-chart-title">訪問エリア</h3>
        {stats.visitedAreas.length === 0 ? (
          <p className="stats-empty">まだエリアが登録されていません</p>
        ) : (
          <div className="stats-areas">
            <div className="stats-areas-count">
              <span className="stats-areas-number">{stats.visitedAreas.length}</span>
              <span className="stats-areas-label">エリア</span>
            </div>
            <div className="stats-areas-list">
              {stats.visitedAreas.map((area) => (
                <span key={area} className="stats-area-tag">{area}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Trips by Theme */}
      <div className="stats-chart-section">
        <h3 className="stats-chart-title">テーマ別旅程数</h3>
        {stats.tripsByTheme.length === 0 ? (
          <p className="stats-empty">まだ旅程がありません</p>
        ) : (
          <div className="stats-theme-grid">
            {stats.tripsByTheme.map(({ theme, count }) => (
              <div key={theme} className={`stats-theme-card stats-theme-card-${theme}`}>
                <div className="stats-theme-card-count">{count}</div>
                <div className="stats-theme-card-label">{getThemeLabel(theme)}</div>
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
