import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { formatDateRange } from '../utils'
import type { TripTheme } from '../types'

type Template = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme
  coverImageUrl: string | null
  templateUses: number
  createdAt: string
}

export function TemplatesPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showError, showSuccess } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [usingTemplate, setUsingTemplate] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/templates')
      if (!res.ok) {
        showError('テンプレートの読み込みに失敗しました')
        return
      }
      const data = (await res.json()) as { templates: Template[] }
      setTemplates(data.templates || [])
    } catch (err) {
      console.error('Failed to fetch templates:', err)
      showError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    if (!authLoading) {
      fetchTemplates()
    }
  }, [authLoading, fetchTemplates])

  async function applyTemplate(templateId: string) {
    if (!user) {
      showError('テンプレートの利用にはログインが必要です')
      return
    }

    setUsingTemplate(templateId)
    try {
      const res = await fetch(`/api/templates/${templateId}/use`, {
        method: 'POST',
      })
      const data = (await res.json()) as { tripId?: string; error?: string }

      if (!res.ok) {
        showError(data.error || 'テンプレートの利用に失敗しました')
        return
      }

      if (data.tripId) {
        showSuccess('テンプレートから旅程を作成しました')
        navigate(`/trips/${data.tripId}/edit`)
      }
    } catch (err) {
      console.error('Failed to use template:', err)
      showError('テンプレートの利用に失敗しました')
    } finally {
      setUsingTemplate(null)
    }
  }

  // Calculate days count from date range
  function getDaysCount(startDate: string | null, endDate: string | null): number {
    if (!startDate || !endDate) return 0
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
  }

  if (loading || authLoading) {
    return (
      <div className="templates-page">
        <div className="templates-header">
          <h1 className="templates-title">テンプレートギャラリー</h1>
          <p className="templates-subtitle">人気の旅行プランをそのまま使える</p>
        </div>
        <div className="templates-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="template-card skeleton">
              <div className="template-card-image skeleton" style={{ height: 160 }} />
              <div className="template-card-content">
                <div className="skeleton" style={{ height: 20, width: '80%', marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 14, width: '60%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="templates-page">
      <div className="templates-header">
        <h1 className="templates-title">テンプレートギャラリー</h1>
        <p className="templates-subtitle">人気の旅行プランをそのまま使える</p>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">—</div>
          <p className="empty-state-text">
            まだテンプレートがありません。
          </p>
        </div>
      ) : (
        <div className="templates-grid">
          {templates.map((template) => (
            <div key={template.id} className="template-card">
              {template.coverImageUrl ? (
                <div
                  className="template-card-image"
                  style={{ backgroundImage: `url(${template.coverImageUrl})` }}
                />
              ) : (
                <div className="template-card-image template-card-image-placeholder">
                  <span className="template-card-image-icon">旅</span>
                </div>
              )}
              <div className="template-card-content">
                <h3 className="template-card-title">{template.title}</h3>
                <div className="template-card-meta">
                  {template.startDate && template.endDate && (
                    <>
                      <span className="template-card-days">
                        {getDaysCount(template.startDate, template.endDate)}日間
                      </span>
                      <span className="template-card-date">
                        {formatDateRange(template.startDate, template.endDate)}
                      </span>
                    </>
                  )}
                </div>
                <div className="template-card-stats">
                  <span className="template-card-uses">
                    {template.templateUses}回使用
                  </span>
                </div>
                <div className="template-card-actions">
                  <Link
                    to={`/trips/${template.id}`}
                    className="btn-text btn-small"
                    onClick={(e) => e.stopPropagation()}
                  >
                    詳細を見る
                  </Link>
                  <button
                    className="btn-filled btn-small"
                    onClick={() => applyTemplate(template.id)}
                    disabled={usingTemplate === template.id}
                  >
                    {usingTemplate === template.id ? '作成中...' : 'このプランを使う'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!user && templates.length > 0 && (
        <div className="templates-login-prompt">
          <p>テンプレートを使うにはログインが必要です</p>
          <Link to="/login" className="btn-filled">
            ログインする
          </Link>
        </div>
      )}

      <button
        className="btn-text back-btn"
        onClick={() => navigate('/trips')}
      >
        ← 旅程一覧に戻る
      </button>
    </div>
  )
}
