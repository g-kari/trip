import { useState, useEffect } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'

type SlotInfo = {
  freeSlots: number
  purchasedSlots: number
  totalSlots: number
  usedSlots: number
  remainingSlots: number
  isPremium: boolean
  pricePerSlot: number
}

type Props = {
  onClose: () => void
}

export function PurchaseModal({ onClose }: Props) {
  useEscapeKey(onClose)
  const [slotInfo, setSlotInfo] = useState<SlotInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [slots, setSlots] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSlotInfo()
  }, [])

  async function fetchSlotInfo() {
    try {
      const res = await fetch('/api/payment/slots')
      if (res.ok) {
        const data = await res.json() as SlotInfo
        setSlotInfo(data)
      }
    } catch (err) {
      console.error('Failed to fetch slot info:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handlePurchase() {
    setPurchasing(true)
    setError(null)

    try {
      const res = await fetch('/api/payment/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      })

      const data = await res.json() as { url?: string; error?: string }

      if (!res.ok) {
        setError(data.error || '決済の開始に失敗しました')
        return
      }

      if (data.url) {
        try {
          const parsed = new URL(data.url);
          if (parsed.hostname === 'checkout.stripe.com' && parsed.protocol === 'https:') {
            window.location.href = data.url;
          } else {
            setError('不正な決済URLです');
          }
        } catch {
          setError('不正な決済URLです');
        }
      }
    } catch (err) {
      console.error('Purchase error:', err)
      setError('決済処理中にエラーが発生しました')
    } finally {
      setPurchasing(false)
    }
  }

  const totalPrice = slotInfo ? slots * slotInfo.pricePerSlot : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal purchase-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="purchase-modal-title">旅程枠を購入</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="purchase-loading">読み込み中...</div>
          ) : slotInfo ? (
            <>
              {/* Current status */}
              <div className="purchase-status">
                <div className="purchase-status-item">
                  <span className="purchase-status-label">現在の枠</span>
                  <span className="purchase-status-value">
                    {slotInfo.usedSlots} / {slotInfo.totalSlots} 使用中
                  </span>
                </div>
                <div className="purchase-status-item">
                  <span className="purchase-status-label">残り枠</span>
                  <span className="purchase-status-value purchase-status-remaining">
                    {slotInfo.remainingSlots} 枠
                  </span>
                </div>
                {slotInfo.isPremium && (
                  <div className="purchase-premium-badge">
                    プレミアム会員（広告非表示）
                  </div>
                )}
              </div>

              {/* Purchase form */}
              <div className="purchase-form">
                <label className="purchase-label">購入枠数</label>
                <div className="purchase-slot-selector">
                  <button
                    type="button"
                    className="purchase-slot-btn"
                    onClick={() => setSlots(Math.max(1, slots - 1))}
                    disabled={slots <= 1}
                  >
                    −
                  </button>
                  <span className="purchase-slot-count">{slots}</span>
                  <button
                    type="button"
                    className="purchase-slot-btn"
                    onClick={() => setSlots(Math.min(10, slots + 1))}
                    disabled={slots >= 10}
                  >
                    +
                  </button>
                </div>

                <div className="purchase-price">
                  <span className="purchase-price-label">合計金額</span>
                  <span className="purchase-price-value">¥{totalPrice.toLocaleString()}</span>
                </div>

                <div className="purchase-benefits">
                  <p className="purchase-benefit-title">購入特典</p>
                  <ul className="purchase-benefit-list">
                    <li>追加の旅程作成枠 {slots} 枠</li>
                    <li>広告の非表示（永久）</li>
                  </ul>
                </div>

                {error && <p className="error-text">{error}</p>}

                <button
                  type="button"
                  className="btn-filled purchase-btn"
                  onClick={handlePurchase}
                  disabled={purchasing}
                >
                  {purchasing ? '処理中...' : `¥${totalPrice.toLocaleString()}で購入`}
                </button>

                <p className="purchase-note">
                  決済はStripeで安全に処理されます
                </p>
              </div>
            </>
          ) : (
            <p className="error-text">枠情報の取得に失敗しました</p>
          )}
        </div>
      </div>
    </div>
  )
}
