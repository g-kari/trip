import { useState, useEffect } from 'react'
import type { SettlementSummary as SettlementSummaryType, MemberBalance, Settlement } from '../types'

type Props = {
  tripId: string
  shareToken?: string  // For shared view
}

export function SettlementSummary({ tripId, shareToken }: Props) {
  const [summary, setSummary] = useState<SettlementSummaryType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<'balances' | 'settlements' | null>('settlements')

  useEffect(() => {
    async function fetchSettlement() {
      setLoading(true)
      setError(null)

      try {
        const url = shareToken
          ? `/api/trips/${tripId}/settlement?token=${shareToken}`
          : `/api/trips/${tripId}/settlement`

        const res = await fetch(url)

        if (!res.ok) {
          const data = await res.json() as { error?: string }
          throw new Error(data.error || '精算情報の取得に失敗しました')
        }

        const data = await res.json() as SettlementSummaryType
        setSummary(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : '精算情報の取得に失敗しました')
      } finally {
        setLoading(false)
      }
    }

    fetchSettlement()
  }, [tripId, shareToken])

  if (loading) {
    return (
      <div className="settlement-summary loading">
        <div className="settlement-loading">読み込み中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="settlement-summary error">
        <div className="settlement-error">{error}</div>
      </div>
    )
  }

  if (!summary || summary.members.length === 0) {
    return (
      <div className="settlement-summary empty">
        <div className="settlement-empty">
          <p className="settlement-empty-title">精算情報がありません</p>
          <p className="settlement-empty-description">
            メンバーを追加して、各アイテムの支払い情報を設定すると精算サマリーが表示されます。
          </p>
        </div>
      </div>
    )
  }

  if (summary.totalExpenses === 0) {
    return (
      <div className="settlement-summary empty">
        <div className="settlement-empty">
          <p className="settlement-empty-title">支払い情報がありません</p>
          <p className="settlement-empty-description">
            各アイテムの支払い情報を設定すると精算サマリーが表示されます。
          </p>
        </div>
      </div>
    )
  }

  const hasSettlements = summary.settlements.length > 0

  return (
    <div className="settlement-summary">
      {/* Header with total */}
      <div className="settlement-header">
        <h3 className="settlement-title">精算サマリー</h3>
        <div className="settlement-total">
          <span className="settlement-total-label">合計費用</span>
          <span className="settlement-total-amount">¥{summary.totalExpenses.toLocaleString()}</span>
        </div>
      </div>

      {/* Settlement actions (who pays whom) */}
      {hasSettlements && (
        <div className="settlement-section">
          <button
            type="button"
            className="settlement-section-header"
            onClick={() => setExpandedSection(expandedSection === 'settlements' ? null : 'settlements')}
          >
            <span className="settlement-section-title">精算アクション</span>
            <span className="settlement-section-toggle">
              {expandedSection === 'settlements' ? '−' : '+'}
            </span>
          </button>

          {expandedSection === 'settlements' && (
            <div className="settlement-section-content">
              <p className="settlement-description">
                以下の支払いで精算が完了します
              </p>
              <div className="settlement-actions-list">
                {summary.settlements.map((settlement, index) => (
                  <SettlementAction key={index} settlement={settlement} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Balance details */}
      <div className="settlement-section">
        <button
          type="button"
          className="settlement-section-header"
          onClick={() => setExpandedSection(expandedSection === 'balances' ? null : 'balances')}
        >
          <span className="settlement-section-title">メンバー別詳細</span>
          <span className="settlement-section-toggle">
            {expandedSection === 'balances' ? '−' : '+'}
          </span>
        </button>

        {expandedSection === 'balances' && (
          <div className="settlement-section-content">
            <div className="settlement-balances-list">
              {summary.balances.map((balance) => (
                <BalanceRow key={balance.memberId} balance={balance} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* All settled message */}
      {!hasSettlements && summary.totalExpenses > 0 && (
        <div className="settlement-settled">
          <span className="settlement-settled-icon">OK</span>
          <span className="settlement-settled-text">精算完了！全員の負担額が一致しています。</span>
        </div>
      )}
    </div>
  )
}

// Settlement action row component
function SettlementAction({ settlement }: { settlement: Settlement }) {
  return (
    <div className="settlement-action">
      <div className="settlement-action-flow">
        <span className="settlement-action-from">{settlement.fromName}</span>
        <span className="settlement-action-arrow">→</span>
        <span className="settlement-action-to">{settlement.toName}</span>
      </div>
      <span className="settlement-action-amount">¥{settlement.amount.toLocaleString()}</span>
    </div>
  )
}

// Balance row component
function BalanceRow({ balance }: { balance: MemberBalance }) {
  const balanceClass = balance.balance > 0 ? 'positive' : balance.balance < 0 ? 'negative' : 'neutral'

  return (
    <div className="settlement-balance-row">
      <span className="settlement-balance-name">{balance.memberName}</span>
      <div className="settlement-balance-details">
        <div className="settlement-balance-item">
          <span className="settlement-balance-label">支払済</span>
          <span className="settlement-balance-value">¥{balance.totalPaid.toLocaleString()}</span>
        </div>
        <div className="settlement-balance-item">
          <span className="settlement-balance-label">負担額</span>
          <span className="settlement-balance-value">¥{balance.totalOwed.toLocaleString()}</span>
        </div>
        <div className={`settlement-balance-item balance ${balanceClass}`}>
          <span className="settlement-balance-label">収支</span>
          <span className="settlement-balance-value">
            {balance.balance >= 0 ? '+' : ''}¥{balance.balance.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}

// Compact settlement view for inline display
export function SettlementCompact({ tripId, shareToken }: Props) {
  const [summary, setSummary] = useState<SettlementSummaryType | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSettlement() {
      try {
        const url = shareToken
          ? `/api/trips/${tripId}/settlement?token=${shareToken}`
          : `/api/trips/${tripId}/settlement`

        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json() as SettlementSummaryType
          setSummary(data)
        }
      } catch (err) {
        console.error('Failed to fetch settlement:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchSettlement()
  }, [tripId, shareToken])

  if (loading || !summary || summary.members.length === 0 || summary.totalExpenses === 0) {
    return null
  }

  const hasSettlements = summary.settlements.length > 0

  return (
    <div className="settlement-compact">
      <div className="settlement-compact-header">
        <span className="settlement-compact-title">精算</span>
        <span className="settlement-compact-total">¥{summary.totalExpenses.toLocaleString()}</span>
      </div>
      {hasSettlements ? (
        <div className="settlement-compact-actions">
          {summary.settlements.slice(0, 3).map((settlement, index) => (
            <div key={index} className="settlement-compact-action">
              <span>{settlement.fromName}</span>
              <span className="settlement-compact-arrow">→</span>
              <span>{settlement.toName}</span>
              <span className="settlement-compact-amount">¥{settlement.amount.toLocaleString()}</span>
            </div>
          ))}
          {summary.settlements.length > 3 && (
            <div className="settlement-compact-more">
              他 {summary.settlements.length - 3} 件
            </div>
          )}
        </div>
      ) : (
        <div className="settlement-compact-settled">精算完了</div>
      )}
    </div>
  )
}
