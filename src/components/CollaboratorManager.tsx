import { useState, useEffect, useCallback } from 'react'
import { TrashIcon, CopyIcon } from './Icons'

type Collaborator = {
  id: string
  userId: string
  role: string
  createdAt: string
  userName: string | null
  userAvatarUrl: string | null
  invitedByName: string | null
}

type PendingInvite = {
  id: string
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

  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [creating, setCreating] = useState(false)

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

  async function createInviteLink() {
    setCreating(true)
    setError(null)

    try {
      const res = await fetch(`/api/trips/${tripId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      const data = await res.json() as { error?: string; inviteToken?: string }

      if (!res.ok) {
        setError(data.error || '招待リンクの作成に失敗しました')
        return
      }

      await fetchCollaborators()

      // Auto-copy the new invite link
      if (data.inviteToken) {
        copyInviteLink(data.inviteToken)
      }
    } catch (err) {
      console.error('Error creating invite link:', err)
      setError('招待リンクの作成に失敗しました')
    } finally {
      setCreating(false)
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
    if (!confirm('この招待リンクを無効にしますか？')) return

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

        {/* Create invite link */}
        <div className="collaborator-invite-section">
          <p className="collaborator-invite-desc">招待リンクを作成して共有しましょう</p>
          <div className="collaborator-invite-row">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              className="input collaborator-role-select"
              disabled={creating}
            >
              <option value="editor">編集者</option>
              <option value="viewer">閲覧者</option>
            </select>
            <button
              type="button"
              className="btn-filled"
              onClick={createInviteLink}
              disabled={creating}
            >
              {creating ? '作成中...' : '招待リンクを作成'}
            </button>
          </div>
        </div>

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
                <h3 className="collaborator-section-title">有効な招待リンク</h3>
                <ul className="collaborator-list">
                  {pendingInvites.map((invite) => (
                    <li key={invite.id} className="collaborator-item pending">
                      <div className="collaborator-info">
                        <span className="collaborator-role-badge">
                          {invite.role === 'editor' ? '編集者' : '閲覧者'}
                        </span>
                        <span className="collaborator-expiry">
                          {formatDate(invite.expiresAt)}まで有効
                        </span>
                      </div>
                      <div className="collaborator-actions">
                        <button
                          className="btn-icon"
                          onClick={() => copyInviteLink(invite.token)}
                          title={copiedToken === invite.token ? 'コピー済み' : 'リンクをコピー'}
                        >
                          <CopyIcon size={16} />
                        </button>
                        <button
                          className="btn-icon btn-danger"
                          onClick={() => cancelInvite(invite.id)}
                          title="無効にする"
                        >
                          <TrashIcon size={16} />
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
                            {collab.userName || 'ユーザー'}
                          </span>
                          <span className="collaborator-role">
                            {collab.role === 'editor' ? '編集者' : '閲覧者'}
                          </span>
                        </div>
                      </div>
                      <button
                        className="btn-icon btn-danger"
                        onClick={() => removeCollaborator(collab.userId)}
                        title="削除"
                      >
                        <TrashIcon size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {collaborators.length === 0 && pendingInvites.length === 0 && (
              <div className="collaborator-empty">
                共同編集者はまだいません。<br />
                招待リンクを作成して共有しましょう。
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
