import { useState, useEffect, useCallback } from 'react'

type Collaborator = {
  id: string
  userId: string
  role: string
  createdAt: string
  userName: string | null
  userEmail: string | null
  userAvatarUrl: string | null
  invitedByName: string | null
}

type PendingInvite = {
  id: string
  email: string
  role: string
  token: string
  createdAt: string
  expiresAt: string
  invitedByName: string | null
}

type Props = {
  tripId: string
  onClose: () => void
}

export function CollaboratorManager({ tripId, onClose }: Props) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [inviting, setInviting] = useState(false)

  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const fetchCollaborators = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/collaborators`)
      if (!res.ok) throw new Error('Failed to fetch collaborators')
      const data = await res.json() as { collaborators: Collaborator[]; pendingInvites: PendingInvite[] }
      setCollaborators(data.collaborators)
      setPendingInvites(data.pendingInvites)
    } catch (err) {
      console.error('Error fetching collaborators:', err)
      setError('共同編集者の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    fetchCollaborators()
  }, [fetchCollaborators])

  async function inviteCollaborator(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setInviting(true)
    setError(null)

    try {
      const res = await fetch(`/api/trips/${tripId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })

      const data = await res.json() as { error?: string; addedDirectly?: boolean }

      if (!res.ok) {
        setError(data.error || '招待に失敗しました')
        return
      }

      setEmail('')
      await fetchCollaborators()

      if (data.addedDirectly) {
        // User was added directly
      }
    } catch (err) {
      console.error('Error inviting collaborator:', err)
      setError('招待に失敗しました')
    } finally {
      setInviting(false)
    }
  }

  async function removeCollaborator(userId: string) {
    if (!confirm('この共同編集者を削除しますか？')) return

    try {
      await fetch(`/api/trips/${tripId}/collaborators/${userId}`, { method: 'DELETE' })
      await fetchCollaborators()
    } catch (err) {
      console.error('Error removing collaborator:', err)
    }
  }

  async function cancelInvite(inviteId: string) {
    if (!confirm('この招待を取り消しますか？')) return

    try {
      await fetch(`/api/trips/${tripId}/invites/${inviteId}`, { method: 'DELETE' })
      await fetchCollaborators()
    } catch (err) {
      console.error('Error canceling invite:', err)
    }
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr)
    return date.toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content collaborator-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">共同編集者を管理</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Invite form */}
        <form className="collaborator-invite-form" onSubmit={inviteCollaborator}>
          <div className="form-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メールアドレス"
              className="input"
              disabled={inviting}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              className="input collaborator-role-select"
              disabled={inviting}
            >
              <option value="editor">編集者</option>
              <option value="viewer">閲覧者</option>
            </select>
          </div>
          <button
            type="submit"
            className="btn-filled"
            disabled={inviting || !email.trim()}
          >
            {inviting ? '招待中...' : '招待する'}
          </button>
        </form>

        {error && (
          <div className="collaborator-error">{error}</div>
        )}

        {loading ? (
          <div className="collaborator-loading">読み込み中...</div>
        ) : (
          <>
            {/* Pending invites */}
            {pendingInvites.length > 0 && (
              <div className="collaborator-section">
                <h3 className="collaborator-section-title">招待中</h3>
                <ul className="collaborator-list">
                  {pendingInvites.map((invite) => (
                    <li key={invite.id} className="collaborator-item pending">
                      <div className="collaborator-info">
                        <span className="collaborator-email">{invite.email}</span>
                        <span className="collaborator-role">{invite.role === 'editor' ? '編集者' : '閲覧者'}</span>
                        <span className="collaborator-expiry">
                          {formatDate(invite.expiresAt)}まで有効
                        </span>
                      </div>
                      <div className="collaborator-actions">
                        <button
                          className="btn-text btn-small"
                          onClick={() => copyInviteLink(invite.token)}
                        >
                          {copiedToken === invite.token ? 'コピー済み' : 'リンクをコピー'}
                        </button>
                        <button
                          className="btn-text btn-small btn-danger"
                          onClick={() => cancelInvite(invite.id)}
                        >
                          取り消す
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Current collaborators */}
            {collaborators.length > 0 && (
              <div className="collaborator-section">
                <h3 className="collaborator-section-title">共同編集者</h3>
                <ul className="collaborator-list">
                  {collaborators.map((collab) => (
                    <li key={collab.id} className="collaborator-item">
                      <div className="collaborator-info">
                        {collab.userAvatarUrl && (
                          <img
                            src={collab.userAvatarUrl}
                            alt=""
                            className="collaborator-avatar"
                          />
                        )}
                        <div className="collaborator-details">
                          <span className="collaborator-name">
                            {collab.userName || collab.userEmail || '名前なし'}
                          </span>
                          <span className="collaborator-role">
                            {collab.role === 'editor' ? '編集者' : '閲覧者'}
                          </span>
                        </div>
                      </div>
                      <button
                        className="btn-text btn-small btn-danger"
                        onClick={() => removeCollaborator(collab.userId)}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {collaborators.length === 0 && pendingInvites.length === 0 && (
              <div className="collaborator-empty">
                共同編集者はまだいません。<br />
                メールアドレスで招待してみましょう。
              </div>
            )}
          </>
        )}

        <div className="modal-footer">
          <p className="collaborator-note">
            編集者は旅程の内容を編集できます。<br />
            閲覧者は閲覧のみ可能です。
          </p>
        </div>
      </div>
    </div>
  )
}
