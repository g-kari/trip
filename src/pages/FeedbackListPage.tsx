import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

type Feedback = {
  id: string
  name: string
  message: string
  createdAt: string
}

export function FeedbackListPage() {
  const { user, loading: authLoading } = useAuth()
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchFeedback() {
      try {
        const res = await fetch('/api/feedback.json')
        if (!res.ok) {
          throw new Error('フィードバックの取得に失敗しました')
        }
        const data = await res.json() as { feedback: Feedback[] }
        setFeedbackList(data.feedback)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました')
      } finally {
        setLoading(false)
      }
    }

    if (!authLoading) {
      fetchFeedback()
    }
  }, [authLoading])

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  }

  if (authLoading || loading) {
    return (
      <div className="feedback-list-page">
        <div className="hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
          <h1 className="hero-title">ご意見一覧</h1>
        </div>
        <div className="empty-state">
          <p className="empty-state-text">読み込み中...</p>
        </div>
      </div>
    )
  }

  // Only allow logged-in users to see the list
  if (!user) {
    return (
      <div className="feedback-list-page">
        <div className="hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
          <h1 className="hero-title">ご意見一覧</h1>
        </div>
        <div className="empty-state">
          <p className="empty-state-text">ログインが必要です</p>
          <Link to="/login" className="btn-filled" style={{ marginTop: 'var(--space-4)' }}>
            ログイン
          </Link>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="feedback-list-page">
        <div className="hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
          <h1 className="hero-title">ご意見一覧</h1>
        </div>
        <div className="empty-state">
          <p className="empty-state-text" style={{ color: 'var(--color-danger)' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="feedback-list-page">
      <div className="hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
        <h1 className="hero-title">ご意見一覧</h1>
        <p className="hero-subtitle">みなさまからのご意見・ご要望</p>
      </div>

      {feedbackList.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-text">まだご意見がありません</p>
        </div>
      ) : (
        <div className="feedback-list">
          {feedbackList.map((feedback) => (
            <div key={feedback.id} className="feedback-card">
              <div className="feedback-header">
                <span className="feedback-name">{feedback.name}</span>
                <span className="feedback-date">{formatDate(feedback.createdAt)}</span>
              </div>
              <p className="feedback-message">{feedback.message}</p>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
        <Link to="/contact" className="btn-outline">
          ご意見を送る
        </Link>
      </div>
    </div>
  )
}
