import { useState, useEffect, useCallback } from 'react'
import type { TripTemplate, TripTheme } from '../types'
import { useToast } from '../hooks/useToast'
import { TrashIcon } from './Icons'

type Props = {
  onClose: () => void
  onSelect: (templateId: string, title: string, startDate: string) => void
}

export function TemplateListModal({ onClose, onSelect }: Props) {
  const { showError, showSuccess } = useToast()
  const [templates, setTemplates] = useState<TripTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<TripTemplate | null>(null)
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/trip-templates')
      if (!res.ok) {
        showError('テンプレートの読み込みに失敗しました')
        return
      }
      const data = (await res.json()) as { templates: TripTemplate[] }
      setTemplates(data.templates || [])
    } catch (err) {
      console.error('Failed to fetch templates:', err)
      showError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  async function deleteTemplate(templateId: string) {
    if (!confirm('このテンプレートを削除しますか？')) return

    try {
      const res = await fetch(`/api/trip-templates/${templateId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        showError('テンプレートの削除に失敗しました')
        return
      }
      setTemplates(prev => prev.filter(t => t.id !== templateId))
      if (selectedTemplate?.id === templateId) {
        setSelectedTemplate(null)
      }
      showSuccess('テンプレートを削除しました')
    } catch (err) {
      console.error('Failed to delete template:', err)
      showError('テンプレートの削除に失敗しました')
    }
  }

  function handleSelectTemplate(template: TripTemplate) {
    setSelectedTemplate(template)
    setTitle(template.name)
  }

  async function handleCreate() {
    if (!selectedTemplate || !title.trim() || !startDate) return

    setCreating(true)
    try {
      onSelect(selectedTemplate.id, title.trim(), startDate)
    } finally {
      setCreating(false)
    }
  }

  function getThemeLabel(theme: TripTheme): string {
    return theme === 'quiet' ? 'しずか' : '写真映え'
  }

  function getDaysCount(template: TripTemplate): number {
    return template.daysData?.length || 0
  }

  function getTotalItems(template: TripTemplate): number {
    return template.daysData?.reduce((sum, day) => sum + (day.items?.length || 0), 0) || 0
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content trip-template-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">テンプレートから作成</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        {loading ? (
          <div className="template-loading">
            <p>読み込み中...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="template-empty-state">
            <p className="template-empty-text">
              保存されたテンプレートがありません
            </p>
            <p className="template-empty-hint">
              旅程の編集画面から「テンプレートとして保存」できます
            </p>
          </div>
        ) : selectedTemplate ? (
          <div className="template-create-form">
            <div className="template-selected-info">
              <span className="template-selected-name">{selectedTemplate.name}</span>
              <button
                type="button"
                className="btn-text btn-small"
                onClick={() => setSelectedTemplate(null)}
              >
                変更
              </button>
            </div>

            <div className="template-create-fields">
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="旅程のタイトル"
                className="input"
                autoFocus
              />
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="input"
              />
            </div>

            <div className="template-create-actions">
              <button
                type="button"
                className="btn-text"
                onClick={() => setSelectedTemplate(null)}
              >
                戻る
              </button>
              <button
                type="button"
                className="btn-filled"
                onClick={handleCreate}
                disabled={creating || !title.trim() || !startDate}
              >
                {creating ? '作成中...' : '作成する'}
              </button>
            </div>
          </div>
        ) : (
          <div className="template-list-container">
            <ul className="trip-template-list">
              {templates.map(template => (
                <li key={template.id} className="trip-template-item">
                  <div
                    className="trip-template-item-content"
                    onClick={() => handleSelectTemplate(template)}
                  >
                    <div className="trip-template-item-header">
                      <span className="trip-template-name">{template.name}</span>
                      <span className={`trip-template-theme trip-template-theme-${template.theme}`}>
                        {getThemeLabel(template.theme)}
                      </span>
                    </div>
                    {template.description && (
                      <p className="trip-template-description">{template.description}</p>
                    )}
                    <div className="trip-template-meta">
                      <span>{getDaysCount(template)}日間</span>
                      <span>{getTotalItems(template)}件の予定</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-icon btn-danger trip-template-delete"
                    onClick={e => {
                      e.stopPropagation()
                      deleteTemplate(template.id)
                    }}
                    title="削除"
                  >
                    <TrashIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-text modal-close" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
