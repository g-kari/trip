import { useState } from 'react'
import { useToast } from '../hooks/useToast'

type Props = {
  tripId: string
  tripTitle: string
  onClose: () => void
  onSaved: () => void
}

export function SaveAsTemplateModal({ tripId, tripTitle, onClose, onSaved }: Props) {
  const { showError, showSuccess } = useToast()
  const [name, setName] = useState(tripTitle)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content save-template-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">テンプレートとして保存</h2>
          <button className="modal-close" onClick={onClose}>x</button>
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
