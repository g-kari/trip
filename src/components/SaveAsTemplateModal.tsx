import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { useEscapeKey } from '../hooks/useEscapeKey'

type Props = {
  tripId: string
  tripTitle: string
  onClose: () => void
  onSaved: () => void
}

export function SaveAsTemplateModal({ tripId, tripTitle, onClose, onSaved }: Props) {
  useEscapeKey(onClose)
  const { showError, showSuccess } = useToast()
  const [name, setName] = useState(tripTitle)
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [showPublicWarning, setShowPublicWarning] = useState(false)
  const [saving, setSaving] = useState(false)

  function handlePublicChange(checked: boolean) {
    if (checked) {
      setShowPublicWarning(true)
    } else {
      setIsPublic(false)
    }
  }

  function confirmPublic() {
    setIsPublic(true)
    setShowPublicWarning(false)
  }

  function cancelPublic() {
    setIsPublic(false)
    setShowPublicWarning(false)
  }

  async function handleSave() {
    if (!name.trim()) return

    setSaving(true)
    try {
      const res = await fetch('/api/trip-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId,
          name: name.trim(),
          description: description.trim() || undefined,
          isPublic,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'テンプレートの保存に失敗しました')
        return
      }

      showSuccess('テンプレートとして保存しました')
      onSaved()
      onClose()
    } catch (err) {
      console.error('Failed to save template:', err)
      showError('テンプレートの保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // Public warning confirmation dialog
  if (showPublicWarning) {
    return (
      <div className="modal-overlay" onClick={cancelPublic}>
        <div className="modal-content save-template-modal" role="dialog" aria-modal="true" aria-labelledby="save-template-public-warning-title" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title" id="save-template-public-warning-title">公開テンプレートの確認</h2>
            <button className="modal-close" onClick={cancelPublic}>×</button>
          </div>

          <div className="public-warning">
            <div className="public-warning-icon">⚠️</div>
            <p className="public-warning-text">
              <strong>このテンプレートを全体公開しますか？</strong>
            </p>
            <ul className="public-warning-list">
              <li>全てのユーザーがこのテンプレートを閲覧・使用できるようになります</li>
              <li>テンプレートに含まれる場所名、時間、費用などの情報が公開されます</li>
              <li>あなたの名前は表示されませんが、テンプレート内容から個人が特定される可能性があります</li>
              <li>一度公開すると、他のユーザーが既にコピーしている場合があります</li>
            </ul>
          </div>

          <div className="modal-footer save-template-actions">
            <button type="button" className="btn-text" onClick={cancelPublic}>
              キャンセル
            </button>
            <button
              type="button"
              className="btn-filled btn-warning"
              onClick={confirmPublic}
            >
              公開する
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content save-template-modal" role="dialog" aria-modal="true" aria-labelledby="save-template-modal-title" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="save-template-modal-title">テンプレートとして保存</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="save-template-form">
          <p className="save-template-hint">
            この旅程の構成をテンプレートとして保存します。
            新規作成時にテンプレートを選ぶだけで、同じ構成の旅程を作成できます。
          </p>

          <div className="form-field">
            <label className="form-label">テンプレート名</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例: 京都2泊3日プラン"
              className="input"
              autoFocus
            />
          </div>

          <div className="form-field">
            <label className="form-label">説明（任意）</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="例: 定番の観光スポットを巡るプラン"
              className="input textarea"
              rows={2}
            />
          </div>

          <div className="form-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={e => handlePublicChange(e.target.checked)}
              />
              <span className="checkbox-text">
                全体公開する
                <span className="checkbox-hint">（他のユーザーもこのテンプレートを使用できます）</span>
              </span>
            </label>
          </div>
        </div>

        <div className="modal-footer save-template-actions">
          <button type="button" className="btn-text" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn-filled"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
