import { useState, useEffect, useCallback } from 'react'
import type { TripMember, StandaloneExpense, ShareType, SettlementSummary } from '../types'

type Props = {
  tripId: string
  isOpen: boolean
  onClose: () => void
}

type Tab = 'participants' | 'expenses' | 'settlements'

type ExpenseFormData = {
  payerId: string
  amount: string
  description: string
  splits: { memberId: string; shareType: ShareType; shareValue: string; isIncluded: boolean }[]
}

export function ExpenseModal({ tripId, isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('participants')
  const [members, setMembers] = useState<TripMember[]>([])
  const [expenses, setExpenses] = useState<StandaloneExpense[]>([])
  const [settlement, setSettlement] = useState<SettlementSummary | null>(null)
  const [loading, setLoading] = useState(true)

  // Participant management state
  const [newMemberName, setNewMemberName] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [deletingMember, setDeletingMember] = useState<string | null>(null)

  // Expense form state
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [expenseForm, setExpenseForm] = useState<ExpenseFormData>({
    payerId: '',
    amount: '',
    description: '',
    splits: [],
  })
  const [savingExpense, setSavingExpense] = useState(false)
  const [deletingExpense, setDeletingExpense] = useState<string | null>(null)

  // Fetch members
  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/members`)
      if (res.ok) {
        const data = await res.json() as { members: TripMember[] }
        setMembers(data.members || [])
      }
    } catch (err) {
      console.error('Failed to fetch members:', err)
    }
  }, [tripId])

  // Fetch expenses
  const fetchExpenses = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`)
      if (res.ok) {
        const data = await res.json() as { expenses: StandaloneExpense[] }
        setExpenses(data.expenses || [])
      }
    } catch (err) {
      console.error('Failed to fetch expenses:', err)
    }
  }, [tripId])

  // Fetch settlement
  const fetchSettlement = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/combined-settlement`)
      if (res.ok) {
        const data = await res.json() as SettlementSummary
        setSettlement(data)
      }
    } catch (err) {
      console.error('Failed to fetch settlement:', err)
    }
  }, [tripId])

  // Fetch all data when modal opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      Promise.all([fetchMembers(), fetchExpenses(), fetchSettlement()])
        .finally(() => setLoading(false))
    }
  }, [isOpen, fetchMembers, fetchExpenses, fetchSettlement])

  // Initialize expense form when members change
  useEffect(() => {
    if (members.length > 0 && !expenseForm.payerId) {
      setExpenseForm(prev => ({
        ...prev,
        payerId: members[0].id,
        splits: members.map(m => ({
          memberId: m.id,
          shareType: 'equal' as ShareType,
          shareValue: '',
          isIncluded: true,
        })),
      }))
    }
  }, [members, expenseForm.payerId])

  // Add member
  async function handleAddMember() {
    if (!newMemberName.trim()) return

    setAddingMember(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })

      if (res.ok) {
        setNewMemberName('')
        await fetchMembers()
        await fetchSettlement()
      }
    } catch (err) {
      console.error('Failed to add member:', err)
    } finally {
      setAddingMember(false)
    }
  }

  // Delete member
  async function handleDeleteMember(memberId: string) {
    if (!confirm('このメンバーを削除しますか？関連する支払い情報も削除されます。')) return

    setDeletingMember(memberId)
    try {
      await fetch(`/api/trips/${tripId}/members/${memberId}`, {
        method: 'DELETE',
      })
      await Promise.all([fetchMembers(), fetchExpenses(), fetchSettlement()])
    } catch (err) {
      console.error('Failed to delete member:', err)
    } finally {
      setDeletingMember(null)
    }
  }

  // Add expense
  async function handleAddExpense() {
    if (!expenseForm.payerId || !expenseForm.amount) return

    const amount = parseInt(expenseForm.amount, 10)
    if (isNaN(amount) || amount <= 0) return

    setSavingExpense(true)
    try {
      const includedSplits = expenseForm.splits.filter(s => s.isIncluded)
      const splits = includedSplits.map(s => ({
        memberId: s.memberId,
        shareType: s.shareType,
        shareValue: s.shareValue ? parseInt(s.shareValue, 10) : undefined,
      }))

      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerId: expenseForm.payerId,
          amount,
          description: expenseForm.description || undefined,
          splits: splits.length > 0 ? splits : undefined,
        }),
      })

      if (res.ok) {
        setShowExpenseForm(false)
        setExpenseForm({
          payerId: members[0]?.id || '',
          amount: '',
          description: '',
          splits: members.map(m => ({
            memberId: m.id,
            shareType: 'equal' as ShareType,
            shareValue: '',
            isIncluded: true,
          })),
        })
        await Promise.all([fetchExpenses(), fetchSettlement()])
      }
    } catch (err) {
      console.error('Failed to add expense:', err)
    } finally {
      setSavingExpense(false)
    }
  }

  // Delete expense
  async function handleDeleteExpense(expenseId: string) {
    if (!confirm('この支払いを削除しますか？')) return

    setDeletingExpense(expenseId)
    try {
      await fetch(`/api/trips/${tripId}/expenses/${expenseId}`, {
        method: 'DELETE',
      })
      await Promise.all([fetchExpenses(), fetchSettlement()])
    } catch (err) {
      console.error('Failed to delete expense:', err)
    } finally {
      setDeletingExpense(null)
    }
  }

  // Toggle member inclusion in split
  function toggleSplitMember(memberId: string) {
    setExpenseForm(prev => ({
      ...prev,
      splits: prev.splits.map(s =>
        s.memberId === memberId ? { ...s, isIncluded: !s.isIncluded } : s
      ),
    }))
  }

  // Update split settings
  function updateSplit(memberId: string, field: 'shareType' | 'shareValue', value: string) {
    setExpenseForm(prev => ({
      ...prev,
      splits: prev.splits.map(s =>
        s.memberId === memberId ? { ...s, [field]: value } : s
      ),
    }))
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content expense-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">割り勘計算</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            x
          </button>
        </div>

        {/* Tabs */}
        <div className="expense-modal-tabs">
          <button
            type="button"
            className={`expense-modal-tab ${activeTab === 'participants' ? 'active' : ''}`}
            onClick={() => setActiveTab('participants')}
          >
            参加者
          </button>
          <button
            type="button"
            className={`expense-modal-tab ${activeTab === 'expenses' ? 'active' : ''}`}
            onClick={() => setActiveTab('expenses')}
          >
            支払い
          </button>
          <button
            type="button"
            className={`expense-modal-tab ${activeTab === 'settlements' ? 'active' : ''}`}
            onClick={() => setActiveTab('settlements')}
          >
            精算
          </button>
        </div>

        {loading ? (
          <div className="expense-modal-loading">読み込み中...</div>
        ) : (
          <div className="expense-modal-body">
            {/* Participants Tab */}
            {activeTab === 'participants' && (
              <div className="expense-tab-content">
                <div className="expense-section-header">
                  <h3 className="expense-section-title">参加者一覧</h3>
                </div>

                {members.length === 0 ? (
                  <p className="expense-empty-text">
                    参加者を追加してください
                  </p>
                ) : (
                  <ul className="expense-participant-list">
                    {members.map(member => (
                      <li key={member.id} className="expense-participant-item">
                        <span className="expense-participant-name">{member.name}</span>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => handleDeleteMember(member.id)}
                          disabled={deletingMember === member.id}
                          title="削除"
                        >
                          {deletingMember === member.id ? '...' : 'x'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="expense-add-participant">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={e => setNewMemberName(e.target.value)}
                    placeholder="参加者の名前"
                    className="input"
                    disabled={addingMember}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddMember()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-filled btn-small"
                    onClick={handleAddMember}
                    disabled={addingMember || !newMemberName.trim()}
                  >
                    {addingMember ? '追加中...' : '追加'}
                  </button>
                </div>
              </div>
            )}

            {/* Expenses Tab */}
            {activeTab === 'expenses' && (
              <div className="expense-tab-content">
                <div className="expense-section-header">
                  <h3 className="expense-section-title">支払い記録</h3>
                  {!showExpenseForm && members.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      onClick={() => setShowExpenseForm(true)}
                    >
                      + 追加
                    </button>
                  )}
                </div>

                {members.length === 0 ? (
                  <p className="expense-empty-text">
                    先に「参加者」タブから参加者を追加してください
                  </p>
                ) : showExpenseForm ? (
                  <div className="expense-form">
                    <div className="expense-form-row">
                      <label className="expense-form-label">支払った人</label>
                      <select
                        value={expenseForm.payerId}
                        onChange={e => setExpenseForm(prev => ({ ...prev, payerId: e.target.value }))}
                        className="select"
                      >
                        {members.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="expense-form-row">
                      <label className="expense-form-label">金額</label>
                      <div className="expense-amount-input">
                        <span className="expense-currency">¥</span>
                        <input
                          type="number"
                          value={expenseForm.amount}
                          onChange={e => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="0"
                          className="input"
                          min="1"
                        />
                      </div>
                    </div>

                    <div className="expense-form-row">
                      <label className="expense-form-label">説明（任意）</label>
                      <input
                        type="text"
                        value={expenseForm.description}
                        onChange={e => setExpenseForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="例: ランチ代"
                        className="input"
                      />
                    </div>

                    <div className="expense-form-row">
                      <label className="expense-form-label">割り勘メンバー</label>
                      <div className="expense-split-members">
                        {members.map(member => {
                          const split = expenseForm.splits.find(s => s.memberId === member.id)
                          const isIncluded = split?.isIncluded ?? true

                          return (
                            <div key={member.id} className={`expense-split-row ${!isIncluded ? 'excluded' : ''}`}>
                              <label className="expense-member-checkbox">
                                <input
                                  type="checkbox"
                                  checked={isIncluded}
                                  onChange={() => toggleSplitMember(member.id)}
                                />
                                <span className="expense-member-name">{member.name}</span>
                              </label>

                              {isIncluded && (
                                <div className="expense-split-custom">
                                  <select
                                    value={split?.shareType || 'equal'}
                                    onChange={e => updateSplit(member.id, 'shareType', e.target.value)}
                                    className="select expense-select-small"
                                  >
                                    <option value="equal">均等</option>
                                    <option value="percentage">%</option>
                                    <option value="amount">固定額</option>
                                  </select>
                                  {split?.shareType === 'percentage' && (
                                    <div className="expense-custom-input">
                                      <input
                                        type="number"
                                        value={split.shareValue}
                                        onChange={e => updateSplit(member.id, 'shareValue', e.target.value)}
                                        className="input expense-input-small"
                                        placeholder="0"
                                        min="0"
                                        max="100"
                                      />
                                      <span>%</span>
                                    </div>
                                  )}
                                  {split?.shareType === 'amount' && (
                                    <div className="expense-custom-input">
                                      <span>¥</span>
                                      <input
                                        type="number"
                                        value={split.shareValue}
                                        onChange={e => updateSplit(member.id, 'shareValue', e.target.value)}
                                        className="input expense-input-small"
                                        placeholder="0"
                                        min="0"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="expense-form-actions">
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => setShowExpenseForm(false)}
                        disabled={savingExpense}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="btn btn-filled"
                        onClick={handleAddExpense}
                        disabled={savingExpense || !expenseForm.payerId || !expenseForm.amount}
                      >
                        {savingExpense ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : expenses.length === 0 ? (
                  <p className="expense-empty-text">
                    支払い記録がありません
                  </p>
                ) : (
                  <ul className="expense-list">
                    {expenses.map(expense => (
                      <li key={expense.id} className="expense-list-item">
                        <div className="expense-list-item-main">
                          <div className="expense-list-item-info">
                            <span className="expense-list-item-payer">{expense.payerName}</span>
                            {expense.description && (
                              <span className="expense-list-item-desc">{expense.description}</span>
                            )}
                          </div>
                          <span className="expense-list-item-amount">
                            ¥{expense.amount.toLocaleString()}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-icon expense-delete-btn"
                          onClick={() => handleDeleteExpense(expense.id)}
                          disabled={deletingExpense === expense.id}
                          title="削除"
                        >
                          {deletingExpense === expense.id ? '...' : 'x'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Settlements Tab */}
            {activeTab === 'settlements' && (
              <div className="expense-tab-content">
                <div className="expense-section-header">
                  <h3 className="expense-section-title">精算結果</h3>
                </div>

                {!settlement || settlement.members.length === 0 ? (
                  <p className="expense-empty-text">
                    参加者を追加して支払いを記録すると、精算結果が表示されます
                  </p>
                ) : settlement.totalExpenses === 0 ? (
                  <p className="expense-empty-text">
                    支払い記録がありません
                  </p>
                ) : (
                  <>
                    {/* Total */}
                    <div className="expense-settlement-total">
                      <span className="expense-settlement-total-label">合計費用</span>
                      <span className="expense-settlement-total-amount">
                        ¥{settlement.totalExpenses.toLocaleString()}
                      </span>
                    </div>

                    {/* Settlement Actions */}
                    {settlement.settlements.length > 0 ? (
                      <div className="expense-settlement-actions">
                        <h4 className="expense-settlement-subtitle">精算アクション</h4>
                        <p className="expense-settlement-description">
                          以下の支払いで精算が完了します
                        </p>
                        <ul className="expense-settlement-list">
                          {settlement.settlements.map((s, index) => (
                            <li key={index} className="expense-settlement-item">
                              <div className="expense-settlement-flow">
                                <span className="expense-settlement-from">{s.fromName}</span>
                                <span className="expense-settlement-arrow">→</span>
                                <span className="expense-settlement-to">{s.toName}</span>
                              </div>
                              <span className="expense-settlement-amount">
                                ¥{s.amount.toLocaleString()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="expense-settlement-settled">
                        <span className="expense-settlement-settled-icon">OK</span>
                        <span>精算完了！全員の負担額が一致しています。</span>
                      </div>
                    )}

                    {/* Member Balances */}
                    <div className="expense-settlement-balances">
                      <h4 className="expense-settlement-subtitle">メンバー別詳細</h4>
                      <ul className="expense-balance-list">
                        {settlement.balances.map(balance => (
                          <li key={balance.memberId} className="expense-balance-item">
                            <span className="expense-balance-name">{balance.memberName}</span>
                            <div className="expense-balance-details">
                              <div className="expense-balance-detail">
                                <span className="expense-balance-label">支払済</span>
                                <span className="expense-balance-value">
                                  ¥{balance.totalPaid.toLocaleString()}
                                </span>
                              </div>
                              <div className="expense-balance-detail">
                                <span className="expense-balance-label">負担額</span>
                                <span className="expense-balance-value">
                                  ¥{balance.totalOwed.toLocaleString()}
                                </span>
                              </div>
                              <div className={`expense-balance-detail balance ${
                                balance.balance > 0 ? 'positive' : balance.balance < 0 ? 'negative' : ''
                              }`}>
                                <span className="expense-balance-label">収支</span>
                                <span className="expense-balance-value">
                                  {balance.balance >= 0 ? '+' : ''}¥{balance.balance.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
