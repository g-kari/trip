import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(token ? 'loading' : 'error')
  const [message, setMessage] = useState(token ? '' : '招待リンクが無効です')
  const [tripId, setTripId] = useState<string | null>(null)
  const [tripTitle, setTripTitle] = useState<string | null>(null)
  const acceptedRef = useRef(false)

  useEffect(() => {
    if (!token || acceptedRef.current) return
    acceptedRef.current = true

    const controller = new AbortController()

    fetch(`/api/collaborator-invites/${token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json() as {
          error?: string
          tripId?: string
          tripTitle?: string
        }

        if (!res.ok) {
          setStatus('error')
          setMessage(data.error || '招待の承認に失敗しました')
          if (data.tripId) {
            setTripId(data.tripId)
          }
          return
        }

        setStatus('success')
        setMessage('招待を承認しました')
        setTripId(data.tripId || null)
        setTripTitle(data.tripTitle || null)

        // Redirect to the trip after 2 seconds
        if (data.tripId) {
          setTimeout(() => {
            navigate(`/trips/${data.tripId}/edit`)
          }, 2000)
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error('Error accepting invite:', err)
        setStatus('error')
        setMessage('招待の承認に失敗しました')
      })

    return () => {
      controller.abort()
    }
  }, [token, navigate])

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="header-logo">旅程</Link>
      </header>

      <main className="main">
        <div className="invite-accept-page">
          {status === 'loading' && (
            <div className="invite-status">
              <div className="invite-loading">招待を確認中...</div>
            </div>
          )}

          {status === 'success' && (
            <div className="invite-status invite-success">
              <h2 className="invite-title">招待を承認しました</h2>
              {tripTitle && (
                <p className="invite-trip-title">「{tripTitle}」への共同編集者として追加されました</p>
              )}
              <p className="invite-redirect">まもなく旅程ページへ移動します...</p>
              {tripId && (
                <Link to={`/trips/${tripId}/edit`} className="btn-filled">
                  今すぐ旅程を開く
                </Link>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="invite-status invite-error">
              <h2 className="invite-title">エラー</h2>
              <p className="invite-message">{message}</p>
              {tripId ? (
                <Link to={`/trips/${tripId}/edit`} className="btn-filled">
                  旅程を開く
                </Link>
              ) : (
                <div className="invite-actions">
                  <Link to="/login" className="btn-outline">
                    ログイン
                  </Link>
                  <Link to="/trips" className="btn-text">
                    旅程一覧へ
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
