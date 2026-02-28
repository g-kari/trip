import { useState, useEffect } from 'react'
import type { TripMember, ExpensePayment, ExpenseSplit, ShareType } from '../types'

type Props = {
  tripId: string
  itemId: string
  itemCost: number | null
  members: TripMember[]
  onMembersChange?: () => void
  readonly?: boolean
}

type PaymentInput = {
  paidBy: string
  amount: number
}

type SplitInput = {
  memberId: string
  shareType: ShareType
  shareValue: number | null
  isIncluded: boolean
}

export function ExpenseSplitter({
  tripId,
  itemId,
  itemCost,
  members,
  onMembersChange,
  readonly = false,
}: Props) {
  const [payments, setPayments] = useState<PaymentInput[]>([])
  const [splits, setSplits] = useState<SplitInput[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal')

  const memberIds = members.map(m => m.id).join(',')

  // Fetch existing expense data
  useEffect(() => {
    async function fetchExpenseData() {
      if (!itemId) return

      setLoading(true)
      try {
        const res = await fetch(`/api/trips/${tripId}/items/${itemId}/expense`)
        if (res.ok) {
          const data = await res.json() as {
            payments: ExpensePayment[]
            splits: ExpenseSplit[]
          }

          // Set payments
          setPayments(data.payments.map(p => ({
            paidBy: p.paidBy,
            amount: p.amount,
          })))

          // Set splits
          if (data.splits.length > 0) {
            setSplitMode('custom')
            setSplits(members.map(m => {
              const existingSplit = data.splits.find(s => s.memberId === m.id)
              return {
                memberId: m.id,
                shareType: (existingSplit?.shareType as ShareType) || 'equal',
                shareValue: existingSplit?.shareValue ?? null,
                isIncluded: !!existingSplit,
              }
            }))
          } else {
            // Default: all members included with equal split
            setSplitMode('equal')
            setSplits(members.map(m => ({
              memberId: m.id,
              shareType: 'equal' as ShareType,
              shareValue: null,
              isIncluded: true,
            })))
          }
        }
      } catch (err) {
        console.error('Failed to fetch expense data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchExpenseData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, itemId, memberIds])

  // Save expense data
  async function saveExpenseData() {
    if (readonly) return

    setSaving(true)
    try {
      const filteredSplits = splitMode === 'equal'
        ? splits.filter(s => s.isIncluded).map(s => ({
            memberId: s.memberId,
            shareType: 'equal' as ShareType,
            shareValue: null,
          }))
        : splits.filter(s => s.isIncluded).map(s => ({
            memberId: s.memberId,
            shareType: s.shareType,
            shareValue: s.shareValue,
          }))

      await fetch(`/api/trips/${tripId}/items/${itemId}/payment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: payments.filter(p => p.amount > 0),
          splits: filteredSplits,
        }),
      })
    } catch (err) {
      console.error('Failed to save expense data:', err)
    } finally {
      setSaving(false)
    }
  }

  // Add payer
  function addPayer() {
    if (members.length === 0) return
    const firstUnused = members.find(m => !payments.some(p => p.paidBy === m.id))
    setPayments([...payments, {
      paidBy: firstUnused?.id || members[0].id,
      amount: itemCost || 0,
    }])
  }

  // Remove payer
  function removePayer(index: number) {
    setPayments(payments.filter((_, i) => i !== index))
  }

  // Update payment
  function updatePayment(index: number, field: 'paidBy' | 'amount', value: string | number) {
    const newPayments = [...payments]
    if (field === 'paidBy') {
      newPayments[index].paidBy = value as string
    } else {
      newPayments[index].amount = Number(value)
    }
    setPayments(newPayments)
  }

  // Toggle member inclusion in split
  function toggleMemberInSplit(memberId: string) {
    setSplits(splits.map(s =>
      s.memberId === memberId ? { ...s, isIncluded: !s.isIncluded } : s
    ))
  }

  // Update split settings
  function updateSplit(memberId: string, field: 'shareType' | 'shareValue', value: ShareType | number | null) {
    setSplits(splits.map(s =>
      s.memberId === memberId
        ? { ...s, [field]: value }
        : s
    ))
  }

  // Add new member
  async function addMember() {
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
        setShowAddMember(false)
        onMembersChange?.()
      }
    } catch (err) {
      console.error('Failed to add member:', err)
    } finally {
      setAddingMember(false)
    }
  }

  // Calculate share preview
  function calculateShares(): { memberId: string; memberName: string; amount: number }[] {
    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0)
    const includedSplits = splits.filter(s => s.isIncluded)

    if (includedSplits.length === 0) return []

    if (splitMode === 'equal') {
      const shareAmount = totalAmount / includedSplits.length
      return includedSplits.map(s => {
        const member = members.find(m => m.id === s.memberId)
        return {
          memberId: s.memberId,
          memberName: member?.name || '不明',
          amount: Math.round(shareAmount),
        }
      })
    }

    // Custom split calculation
    const result: { memberId: string; memberName: string; amount: number }[] = []
    let remaining = totalAmount

    // Fixed amounts first
    const amountSplits = includedSplits.filter(s => s.shareType === 'amount')
    for (const split of amountSplits) {
      const amount = split.shareValue || 0
      const member = members.find(m => m.id === split.memberId)
      result.push({
        memberId: split.memberId,
        memberName: member?.name || '不明',
        amount,
      })
      remaining -= amount
    }

    // Percentage splits
    const percentageSplits = includedSplits.filter(s => s.shareType === 'percentage')
    for (const split of percentageSplits) {
      const percentage = split.shareValue || 0
      const amount = Math.round((totalAmount * percentage) / 100)
      const member = members.find(m => m.id === split.memberId)
      result.push({
        memberId: split.memberId,
        memberName: member?.name || '不明',
        amount,
      })
      remaining -= amount
    }

    // Equal splits get the remaining
    const equalSplits = includedSplits.filter(s => s.shareType === 'equal')
    if (equalSplits.length > 0) {
      const shareAmount = remaining / equalSplits.length
      for (const split of equalSplits) {
        const member = members.find(m => m.id === split.memberId)
        result.push({
          memberId: split.memberId,
          memberName: member?.name || '不明',
          amount: Math.round(shareAmount),
        })
      }
    }

    return result
  }

  const sharePreview = calculateShares()
  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0)

  if (loading) {
    return <div className="expense-splitter loading">読み込み中...</div>
  }

  if (members.length === 0) {
    return (
      <div className="expense-splitter empty">
        <p className="expense-empty-message">
          費用分割にはメンバーの追加が必要です
        </p>
        {!readonly && (
          <button
            type="button"
            className="btn btn-outline btn-small"
            onClick={() => setShowAddMember(true)}
          >
            メンバーを追加
          </button>
        )}
        {showAddMember && (
          <div className="add-member-form">
            <input
              type="text"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="メンバー名"
              className="input"
              disabled={addingMember}
            />
            <div className="add-member-actions">
              <button
                type="button"
                className="btn btn-filled btn-small"
                onClick={addMember}
                disabled={addingMember || !newMemberName.trim()}
              >
                追加
              </button>
              <button
                type="button"
                className="btn btn-outline btn-small"
                onClick={() => { setShowAddMember(false); setNewMemberName(''); }}
                disabled={addingMember}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="expense-splitter">
      {/* Payment section */}
      <div className="expense-section">
        <h4 className="expense-section-title">支払った人</h4>
        {payments.map((payment, index) => (
          <div key={index} className="expense-payment-row">
            <select
              value={payment.paidBy}
              onChange={(e) => updatePayment(index, 'paidBy', e.target.value)}
              className="select expense-select"
              disabled={readonly}
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="expense-amount-input">
              <span className="expense-currency">¥</span>
              <input
                type="number"
                value={payment.amount}
                onChange={(e) => updatePayment(index, 'amount', e.target.value)}
                className="input expense-input"
                placeholder="金額"
                disabled={readonly}
              />
            </div>
            {!readonly && payments.length > 1 && (
              <button
                type="button"
                className="btn-icon expense-remove-btn"
                onClick={() => removePayer(index)}
                title="削除"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readonly && (
          <button
            type="button"
            className="btn btn-outline btn-small expense-add-btn"
            onClick={addPayer}
          >
            + 支払者を追加
          </button>
        )}
      </div>

      {/* Split section */}
      <div className="expense-section">
        <h4 className="expense-section-title">割り勘設定</h4>

        {!readonly && (
          <div className="expense-split-mode">
            <label className="expense-radio-label">
              <input
                type="radio"
                name="splitMode"
                checked={splitMode === 'equal'}
                onChange={() => setSplitMode('equal')}
              />
              均等割り
            </label>
            <label className="expense-radio-label">
              <input
                type="radio"
                name="splitMode"
                checked={splitMode === 'custom'}
                onChange={() => setSplitMode('custom')}
              />
              カスタム
            </label>
          </div>
        )}

        <div className="expense-split-members">
          {members.map(member => {
            const split = splits.find(s => s.memberId === member.id)
            const isIncluded = split?.isIncluded ?? true

            return (
              <div key={member.id} className={`expense-split-row ${!isIncluded ? 'excluded' : ''}`}>
                <label className="expense-member-checkbox">
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={() => toggleMemberInSplit(member.id)}
                    disabled={readonly}
                  />
                  <span className="expense-member-name">{member.name}</span>
                </label>

                {splitMode === 'custom' && isIncluded && (
                  <div className="expense-split-custom">
                    <select
                      value={split?.shareType || 'equal'}
                      onChange={(e) => updateSplit(member.id, 'shareType', e.target.value as ShareType)}
                      className="select expense-select-small"
                      disabled={readonly}
                    >
                      <option value="equal">均等</option>
                      <option value="percentage">%</option>
                      <option value="amount">固定額</option>
                    </select>
                    {split?.shareType === 'percentage' && (
                      <div className="expense-custom-input">
                        <input
                          type="number"
                          value={split.shareValue ?? ''}
                          onChange={(e) => updateSplit(member.id, 'shareValue', e.target.value ? Number(e.target.value) : null)}
                          className="input expense-input-small"
                          placeholder="0"
                          min="0"
                          max="100"
                          disabled={readonly}
                        />
                        <span>%</span>
                      </div>
                    )}
                    {split?.shareType === 'amount' && (
                      <div className="expense-custom-input">
                        <span>¥</span>
                        <input
                          type="number"
                          value={split.shareValue ?? ''}
                          onChange={(e) => updateSplit(member.id, 'shareValue', e.target.value ? Number(e.target.value) : null)}
                          className="input expense-input-small"
                          placeholder="0"
                          min="0"
                          disabled={readonly}
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

      {/* Preview section */}
      {sharePreview.length > 0 && totalPayments > 0 && (
        <div className="expense-section expense-preview">
          <h4 className="expense-section-title">負担額プレビュー</h4>
          <div className="expense-preview-list">
            {sharePreview.map(share => (
              <div key={share.memberId} className="expense-preview-row">
                <span className="expense-preview-name">{share.memberName}</span>
                <span className="expense-preview-amount">¥{share.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="expense-preview-total">
            <span>合計</span>
            <span>¥{totalPayments.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Save button */}
      {!readonly && (
        <div className="expense-actions">
          <button
            type="button"
            className="btn btn-filled"
            onClick={saveExpenseData}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  )
}

// Member management component
export function TripMemberManager({
  tripId,
  members,
  onMembersChange,
  readonly = false,
}: {
  tripId: string
  members: TripMember[]
  onMembersChange: () => void
  readonly?: boolean
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function addMember() {
    if (!newMemberName.trim()) return

    setAdding(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })

      if (res.ok) {
        setNewMemberName('')
        setShowAddForm(false)
        onMembersChange()
      }
    } catch (err) {
      console.error('Failed to add member:', err)
    } finally {
      setAdding(false)
    }
  }

  async function deleteMember(memberId: string) {
    if (!confirm('このメンバーを削除しますか？関連する支払い情報も削除されます。')) return

    setDeleting(memberId)
    try {
      await fetch(`/api/trips/${tripId}/members/${memberId}`, {
        method: 'DELETE',
      })
      onMembersChange()
    } catch (err) {
      console.error('Failed to delete member:', err)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="trip-member-manager">
      <h3 className="member-manager-title">旅行メンバー</h3>

      {members.length === 0 ? (
        <p className="member-empty-message">
          メンバーがいません。費用分割機能を使うにはメンバーを追加してください。
        </p>
      ) : (
        <ul className="member-list">
          {members.map(member => (
            <li key={member.id} className="member-list-item">
              <span className="member-name">{member.name}</span>
              {!readonly && (
                <button
                  type="button"
                  className="btn-icon member-delete-btn"
                  onClick={() => deleteMember(member.id)}
                  disabled={deleting === member.id}
                  title="削除"
                >
                  {deleting === member.id ? '...' : '×'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readonly && (
        <>
          {showAddForm ? (
            <div className="member-add-form">
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="メンバー名"
                className="input"
                disabled={adding}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addMember()
                  }
                }}
              />
              <div className="member-add-actions">
                <button
                  type="button"
                  className="btn btn-filled btn-small"
                  onClick={addMember}
                  disabled={adding || !newMemberName.trim()}
                >
                  {adding ? '追加中...' : '追加'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => { setShowAddForm(false); setNewMemberName(''); }}
                  disabled={adding}
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-small member-add-btn"
              onClick={() => setShowAddForm(true)}
            >
              + メンバーを追加
            </button>
          )}
        </>
      )}
    </div>
  )
}
