import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'

type ProfileData = {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  provider: 'google' | 'line'
  createdAt: string
}

type ProfileStats = {
  totalTrips: number
  archivedTrips: number
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, loading: authLoading, logout, refreshUser } = useAuth()
  const { showSuccess, showError } = useToast()

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) {
        if (res.status === 401) {
          navigate('/login')
          return
        }
        showError('プロフィールの取得に失敗しました')
        return
      }
      const data = (await res.json()) as { profile: ProfileData; stats: ProfileStats }
      setProfile(data.profile)
      setStats(data.stats)
      setEditName(data.profile.name || '')
    } catch (err) {
      console.error('Failed to fetch profile:', err)
      showError('プロフィールの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [navigate, showError])

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        navigate('/login')
        return
      }
      fetchProfile()
    }
  }, [authLoading, user, navigate, fetchProfile])

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!editName.trim()) {
      showError('表示名を入力してください')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })

      const data = (await res.json()) as { profile?: ProfileData; error?: string }
      if (!res.ok) {
        showError(data.error || '更新に失敗しました')
        return
      }

      if (data.profile) {
        setProfile((prev) => prev ? { ...prev, name: data.profile!.name } : prev)
        setIsEditing(false)
        showSuccess('表示名を更新しました')
        // Refresh auth context to update header
        await refreshUser()
      }
    } catch (err) {
      console.error('Failed to update profile:', err)
      showError('更新に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== 'アカウントを削除') {
      showError('確認テキストが一致しません')
      return
    }

    setDeleting(true)
    try {
      const res = await fetch('/api/profile', { method: 'DELETE' })
      if (!res.ok) {
        showError('アカウントの削除に失敗しました')
        return
      }

      showSuccess('アカウントを削除しました')
      await logout()
      navigate('/')
    } catch (err) {
      console.error('Failed to delete account:', err)
      showError('アカウントの削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  }

  function getProviderName(provider: 'google' | 'line'): string {
    return provider === 'google' ? 'Google' : 'LINE'
  }

  if (loading || authLoading) {
    return (
      <div className="profile-page">
        <div className="profile-loading">
          <p>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="profile-page">
        <div className="profile-error">
          <p>プロフィールが見つかりませんでした</p>
        </div>
      </div>
    )
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1 className="profile-title">プロフィール</h1>
      </div>

      {/* User Info Card */}
      <div className="profile-card">
        <div className="profile-avatar-section">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="profile-avatar" />
          ) : (
            <div className="profile-avatar-placeholder">
              {(profile.name || profile.email || '?').charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="profile-info">
          {isEditing ? (
            <form className="profile-edit-form" onSubmit={handleSaveName}>
              <div className="profile-edit-row">
                <label className="profile-label">表示名</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="input"
                  placeholder="表示名"
                  maxLength={50}
                  autoFocus
                />
              </div>
              <div className="profile-edit-actions">
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setIsEditing(false)
                    setEditName(profile.name || '')
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="btn-filled"
                  disabled={saving || !editName.trim()}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="profile-name-row">
                <span className="profile-name">{profile.name || '名前未設定'}</span>
                <button
                  type="button"
                  className="btn-text btn-small"
                  onClick={() => setIsEditing(true)}
                >
                  編集
                </button>
              </div>
              {profile.email && (
                <span className="profile-email">{profile.email}</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Account Info */}
      <div className="profile-section">
        <h2 className="profile-section-title">アカウント情報</h2>
        <div className="profile-info-list">
          <div className="profile-info-item">
            <span className="profile-info-label">認証プロバイダー</span>
            <span className="profile-info-value">
              <span className={`provider-badge provider-${profile.provider}`}>
                {getProviderName(profile.provider)}
              </span>
            </span>
          </div>
          <div className="profile-info-item">
            <span className="profile-info-label">登録日</span>
            <span className="profile-info-value">{formatDate(profile.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="profile-section">
          <h2 className="profile-section-title">統計</h2>
          <div className="profile-stats-grid">
            <div className="profile-stat-card">
              <span className="profile-stat-value">{stats.totalTrips}</span>
              <span className="profile-stat-label">旅程</span>
            </div>
            <div className="profile-stat-card">
              <span className="profile-stat-value">{stats.archivedTrips}</span>
              <span className="profile-stat-label">アーカイブ済み</span>
            </div>
          </div>
        </div>
      )}

      {/* Feedback */}
      <div className="profile-section">
        <h2 className="profile-section-title">サポート</h2>
        <div className="profile-actions">
          <Link to="/feedback" className="btn-outline profile-action-btn">
            ご意見一覧を見る
          </Link>
        </div>
      </div>

      {/* Actions */}
      <div className="profile-section">
        <h2 className="profile-section-title">アカウント操作</h2>
        <div className="profile-actions">
          <button
            type="button"
            className="btn-outline profile-action-btn"
            onClick={handleLogout}
          >
            ログアウト
          </button>
          <button
            type="button"
            className="btn-outline btn-danger-outline profile-action-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            アカウントを削除
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal profile-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">アカウントを削除</h2>
            <div className="profile-delete-warning">
              <p>この操作は取り消せません。</p>
              <p>アカウントを削除すると、以下のデータがすべて削除されます:</p>
              <ul className="profile-delete-list">
                <li>すべての旅程</li>
                <li>日程と予定</li>
                <li>アップロードした画像</li>
                <li>共有リンク</li>
              </ul>
            </div>
            <div className="profile-delete-confirm">
              <p>確認のため「<strong>アカウントを削除</strong>」と入力してください:</p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="input"
                placeholder="アカウントを削除"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setDeleteConfirmText('')
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-filled btn-danger"
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmText !== 'アカウントを削除'}
              >
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
