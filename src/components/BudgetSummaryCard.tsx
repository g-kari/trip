import type { BudgetSummary } from '../types'
import { formatCost } from '../utils'

export function BudgetSummaryCard({ summary }: { summary: BudgetSummary }) {
  return (
    <div className="budget-summary-card">
      <h3 className="budget-summary-title">予算サマリー</h3>

      {/* Budget overview */}
      <div className="budget-overview">
        <div className="budget-row">
          <span className="budget-label">合計費用</span>
          <span className="budget-value">{formatCost(summary.totalSpent)}</span>
        </div>
        {summary.totalBudget !== null && (
          <>
            <div className="budget-row">
              <span className="budget-label">予算</span>
              <span className="budget-value">{formatCost(summary.totalBudget)}</span>
            </div>
            <div className="budget-row">
              <span className="budget-label">残り</span>
              <span className={`budget-value ${summary.isOverBudget ? 'budget-over' : 'budget-under'}`}>
                {summary.remaining !== null && (summary.remaining >= 0 ? formatCost(summary.remaining) : `-${formatCost(Math.abs(summary.remaining))}`)}
              </span>
            </div>
            {/* Progress bar */}
            <div className="budget-progress-container">
              <div
                className={`budget-progress-bar ${summary.isOverBudget ? 'over' : ''}`}
                style={{ width: `${summary.totalBudget > 0 ? Math.min((summary.totalSpent / summary.totalBudget) * 100, 100) : 0}%` }}
              />
            </div>
            {summary.isOverBudget && (
              <div className="budget-warning">
                予算を超過しています
              </div>
            )}
          </>
        )}
      </div>

      {/* Category breakdown */}
      {summary.byCategory.length > 0 && (
        <div className="budget-categories">
          <h4 className="budget-categories-title">カテゴリ別内訳</h4>
          {summary.byCategory.map((cat) => (
            <div key={cat.category} className="budget-category-row">
              <span className="budget-category-name">{cat.category}</span>
              <div className="budget-category-bar-container">
                <div
                  className="budget-category-bar"
                  style={{ width: `${cat.percentage}%` }}
                />
              </div>
              <span className="budget-category-amount">{formatCost(cat.amount)}</span>
              <span className="budget-category-percent">{cat.percentage}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
