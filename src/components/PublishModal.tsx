import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../hooks/useToast'
import { GlobeIcon } from './Icons'

type PublishModalProps = {
  tripId: string
  tripTitle: string
  onClose: () => void
  onPublishChange?: (isPublic: boolean) => void
}

type PublishStatus = {
  isPublic: boolean
  publicTitle: string | null
  likeCount: number
}

export function PublishModal({ tripId, tripTitle, onClose, onPublishChange }: PublishModalProps) {
  const { showError, showSuccess } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<PublishStatus | null>(null)

  // Form state
  const [isPublic, setIsPublic] = useState(false)
  const [publicTitle, setPublicTitle] = useState('')
  const [excludeNotes, setExcludeNotes] = useState(true)

  const fetchPublishStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/publish`)
      if (!res.ok) {
        showError('公開設定の取得に失敗しました')
        onClose()
        return
      }
      const data = (await res.json()) as PublishStatus
      setStatus(data)
      setIsPublic(data.isPublic)
      setPublicTitle(data.publicTitle || '')
    } catch (err) {
      console.error('Failed to fetch publish status:', err)
      showError('公開設定の取得に失敗しました')
      onClose()
    } finally {
      setLoading(false)
    }
  }, [tripId, showError, onClose])

  useEffect(() => {
    fetchPublishStatus()
  }, [fetchPublishStatus])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/publish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublic,
          publicTitle: publicTitle.trim() || undefined,
          excludeNotes,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || '公開設定の保存に失敗しました')
        return
      }

      showSuccess(isPublic ? 'ギャラリーに公開しました' : '公開を停止しました')
      onPublishChange?.(isPublic)
      onClose()
    } catch (err) {
      console.error('Failed to save publish settings:', err)
      showError('公開設定の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="modal-title">公開設定</h2>
          <div className="publish-modal-loading">
            <p>読み込み中...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal publish-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          <GlobeIcon size={20} />
          <span>ギャラリーに公開</span>
        </h2>

        <div className="publish-modal-content">
          <p className="publish-modal-description">
            この旅程をギャラリーに公開すると、他のユーザーが参考にすることができます。
            個人情報は自動的に除外されます。
          </p>

          {/* Public toggle */}
          <div className="publish-option">
            <label className="publish-toggle">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span className="publish-toggle-slider" />
              <span className="publish-toggle-label">
                {isPublic ? '公開中' : '非公開'}
              </span>
            </label>
          </div>

          {isPublic && (
            <>
              {/* Public title */}
              <div className="publish-option">
                <label className="publish-option-label">
                  公開用タイトル（任意）
                </label>
                <p className="publish-option-hint">
                  空欄の場合は元のタイトル「{tripTitle}」が使用されます
                </p>
                <input
                  type="text"
                  value={publicTitle}
                  onChange={(e) => setPublicTitle(e.target.value)}
                  className="input"
                  placeholder="公開用のタイトルを入力"
                  maxLength={100}
                />
              </div>

              {/* Exclude notes */}
              <div className="publish-option">
                <label className="publish-checkbox">
                  <input
                    type="checkbox"
                    checked={excludeNotes}
                    onChange={(e) => setExcludeNotes(e.target.checked)}
                  />
                  <span>メモ・コメントを非公開にする（推奨）</span>
                </label>
                <p className="publish-option-hint">
                  チェックを入れると、予定のメモやコメントは公開されません
                </p>
              </div>

              {/* Like count info */}
              {status && status.likeCount > 0 && (
                <div className="publish-stats">
                  <span className="publish-stats-label">現在のいいね数:</span>
                  <span className="publish-stats-value">{status.likeCount}</span>
                </div>
              )}
            </>
          )}

          {/* Privacy notice */}
          <div className="publish-notice">
            <h4>公開時の注意事項</h4>
            <ul>
              <li>タイトル、日程、予定の内容が公開されます</li>
              <li>写真やカバー画像は公開されません</li>
              <li>いつでも公開を停止できます</li>
              <li>他のユーザーがこの旅程を参考にできます</li>
            </ul>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-text" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn-filled"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
