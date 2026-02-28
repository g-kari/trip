import { useState } from 'react'
import { Link } from 'react-router-dom'

export function ContactPage() {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || '匿名',
          message: message.trim(),
        }),
      })

      if (!res.ok) {
        throw new Error('送信に失敗しました')
      }

      setSubmitted(true)
      setName('')
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="header-logo">旅程</Link>
      </header>

      <main className="main">
        <div className="hero contact-hero">
          <h1 className="hero-title">お問い合わせ</h1>
          <p className="hero-subtitle">ご意見・ご要望をお聞かせください</p>
        </div>

        {submitted ? (
          <div className="empty-state">
            <p className="empty-state-text">
              ありがとうございます。<br />
              フィードバックを受け付けました。
            </p>
            <button
              className="btn-outline contact-submit-another"
              onClick={() => setSubmitted(false)}
            >
              別のフィードバックを送る
            </button>
          </div>
        ) : (
          <form className="create-form" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="お名前（任意）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
            <textarea
              placeholder="ご意見・ご要望"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input contact-textarea"
              rows={5}
              required
            />
            {error && (
              <p className="contact-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="btn-filled"
              disabled={submitting || !message.trim()}
            >
              {submitting ? '送信中...' : '送信する'}
            </button>
          </form>
        )}

        <Link to="/" className="btn-text back-btn contact-back-link">
          ← トップに戻る
        </Link>
      </main>

      <footer className="footer">
        <span className="footer-text">旅程</span>
      </footer>
    </div>
  )
}
