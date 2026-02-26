import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type { TripComment, CommentStats } from '../types'

type Props = {
  tripId: string
  isOwner?: boolean
  token?: string  // If provided, use shared trip API
  itemId?: string  // If provided, show only comments for this item
}

function formatCommentDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return '今'
  if (diffMins < 60) return `${diffMins}分前`
  if (diffHours < 24) return `${diffHours}時間前`
  if (diffDays < 7) return `${diffDays}日前`

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function UserAvatar({ name, avatarUrl, size = 'medium' }: {
  name: string | null;
  avatarUrl: string | null;
  size?: 'small' | 'medium'
}) {
  const sizeClass = size === 'small' ? 'comment-avatar-small' : 'comment-avatar'

  if (avatarUrl) {
    return <img src={avatarUrl} alt={name || ''} className={sizeClass} />
  }

  const initial = name ? name.charAt(0).toUpperCase() : '?'
  return <div className={`${sizeClass} comment-avatar-placeholder`}>{initial}</div>
}

type CommentItemProps = {
  comment: TripComment
  currentUserId: string | null
  isOwner: boolean
  onEdit: (id: string, content: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onReply: (parentId: string) => void
  onPin?: (id: string) => Promise<void>
  replyingTo: string | null
  replyContent: string
  setReplyContent: (content: string) => void
  onSubmitReply: (parentId: string) => Promise<void>
  submitting: boolean
}

function CommentItem({
  comment,
  currentUserId,
  isOwner,
  onEdit,
  onDelete,
  onReply,
  onPin,
  replyingTo,
  replyContent,
  setReplyContent,
  onSubmitReply,
  submitting,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [saving, setSaving] = useState(false)

  const isAuthor = currentUserId === comment.userId
  const canEdit = isAuthor
  const canDelete = isAuthor || isOwner
  const canPin = isOwner && !comment.parentId
  const isReplyTarget = replyingTo === comment.id

  async function handleSaveEdit() {
    if (!editContent.trim()) return
    setSaving(true)
    try {
      await onEdit(comment.id, editContent.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`comment-item ${comment.isPinned ? 'comment-pinned' : ''}`}>
      <div className="comment-header">
        <UserAvatar name={comment.userName} avatarUrl={comment.userAvatarUrl} />
        <div className="comment-meta">
          <span className="comment-author">{comment.userName || '匿名'}</span>
          <span className="comment-date">{formatCommentDate(comment.createdAt)}</span>
          {comment.isPinned && <span className="comment-pin-badge">ピン留め</span>}
          {comment.createdAt !== comment.updatedAt && (
            <span className="comment-edited">(編集済み)</span>
          )}
        </div>
        <div className="comment-actions">
          {canPin && onPin && (
            <button
              type="button"
              className="comment-action-btn"
              onClick={() => onPin(comment.id)}
              title={comment.isPinned ? 'ピン留め解除' : 'ピン留め'}
            >
              {comment.isPinned ? '\u2605' : '\u2606'}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="comment-action-btn"
              onClick={() => setEditing(true)}
              title="編集"
            >
              編集
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="comment-action-btn comment-action-delete"
              onClick={() => onDelete(comment.id)}
              title="削除"
            >
              削除
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="comment-edit-form">
          <textarea
            className="input textarea comment-textarea"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            maxLength={2000}
            autoFocus
          />
          <div className="comment-edit-actions">
            <button
              type="button"
              className="btn-outline btn-small"
              onClick={() => {
                setEditing(false)
                setEditContent(comment.content)
              }}
              disabled={saving}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="btn-filled btn-small"
              onClick={handleSaveEdit}
              disabled={saving || !editContent.trim()}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="comment-content">{comment.content}</div>
      )}

      {/* Reply button */}
      {!comment.parentId && currentUserId && !editing && (
        <button
          type="button"
          className="comment-reply-btn"
          onClick={() => onReply(isReplyTarget ? '' : comment.id)}
        >
          {isReplyTarget ? 'キャンセル' : '返信'}
        </button>
      )}

      {/* Reply form */}
      {isReplyTarget && (
        <div className="comment-reply-form">
          <textarea
            className="input textarea comment-textarea"
            placeholder="返信を入力..."
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            rows={2}
            maxLength={2000}
          />
          <div className="comment-reply-actions">
            <button
              type="button"
              className="btn-filled btn-small"
              onClick={() => onSubmitReply(comment.id)}
              disabled={submitting || !replyContent.trim()}
            >
              {submitting ? '投稿中...' : '返信'}
            </button>
          </div>
        </div>
      )}

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="comment-reply-item">
              <div className="comment-header">
                <UserAvatar name={reply.userName} avatarUrl={reply.userAvatarUrl} size="small" />
                <div className="comment-meta">
                  <span className="comment-author">{reply.userName || '匿名'}</span>
                  <span className="comment-date">{formatCommentDate(reply.createdAt)}</span>
                  {reply.createdAt !== reply.updatedAt && (
                    <span className="comment-edited">(編集済み)</span>
                  )}
                </div>
                <div className="comment-actions">
                  {currentUserId === reply.userId && (
                    <button
                      type="button"
                      className="comment-action-btn"
                      onClick={() => onDelete(reply.id)}
                      title="削除"
                    >
                      削除
                    </button>
                  )}
                  {isOwner && currentUserId !== reply.userId && (
                    <button
                      type="button"
                      className="comment-action-btn comment-action-delete"
                      onClick={() => onDelete(reply.id)}
                      title="削除"
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>
              <div className="comment-content">{reply.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommentSection({ tripId, isOwner = false, token, itemId }: Props) {
  const { user } = useAuth()
  const { showSuccess, showError } = useToast()
  const [comments, setComments] = useState<TripComment[]>([])
  const [stats, setStats] = useState<CommentStats>({ total: 0, pinned: 0 })
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')

  const apiBase = token ? `/api/shared/${token}` : `/api/trips/${tripId}`

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/comments`)
      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          // No access or trip not found
          return
        }
        throw new Error('Failed to fetch comments')
      }
      const data = await res.json() as { comments: TripComment[]; stats: CommentStats }

      // Filter by itemId if provided
      let filteredComments = data.comments
      if (itemId) {
        filteredComments = data.comments.filter(c => c.itemId === itemId)
      }

      setComments(filteredComments)
      setStats(data.stats)
    } catch (err) {
      console.error('Error fetching comments:', err)
    } finally {
      setLoading(false)
    }
  }, [apiBase, itemId])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim() || !user) return

    setSubmitting(true)
    try {
      const res = await fetch(`${apiBase}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          itemId: itemId || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'コメントの投稿に失敗しました')
        return
      }

      const data = await res.json() as { comment: TripComment }
      setComments([...comments, data.comment])
      setStats({ ...stats, total: stats.total + 1 })
      setNewComment('')
      showSuccess('コメントを投稿しました')
    } catch (err) {
      console.error('Error submitting comment:', err)
      showError('コメントの投稿に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReply(parentId: string) {
    if (!replyContent.trim() || !user) return

    setSubmitting(true)
    try {
      const res = await fetch(`${apiBase}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: replyContent.trim(),
          parentId,
          itemId: itemId || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || '返信の投稿に失敗しました')
        return
      }

      const data = await res.json() as { comment: TripComment }

      // Add reply to the parent comment
      setComments(comments.map(c => {
        if (c.id === parentId) {
          return {
            ...c,
            replies: [...(c.replies || []), data.comment],
          }
        }
        return c
      }))
      setStats({ ...stats, total: stats.total + 1 })
      setReplyContent('')
      setReplyingTo(null)
      showSuccess('返信を投稿しました')
    } catch (err) {
      console.error('Error submitting reply:', err)
      showError('返信の投稿に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  async function editComment(commentId: string, content: string) {
    try {
      const res = await fetch(`/api/trips/${tripId}/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'コメントの編集に失敗しました')
        return
      }

      const data = await res.json() as { comment: TripComment }

      // Update comment in list
      setComments(comments.map(c => {
        if (c.id === commentId) {
          return { ...c, content: data.comment.content, updatedAt: data.comment.updatedAt }
        }
        // Check replies
        if (c.replies) {
          return {
            ...c,
            replies: c.replies.map(r =>
              r.id === commentId
                ? { ...r, content: data.comment.content, updatedAt: data.comment.updatedAt }
                : r
            ),
          }
        }
        return c
      }))
      showSuccess('コメントを編集しました')
    } catch (err) {
      console.error('Error editing comment:', err)
      showError('コメントの編集に失敗しました')
    }
  }

  async function deleteComment(commentId: string) {
    if (!confirm('このコメントを削除しますか？')) return

    try {
      const res = await fetch(`/api/trips/${tripId}/comments/${commentId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'コメントの削除に失敗しました')
        return
      }

      // Remove comment from list
      setComments(comments.filter(c => {
        if (c.id === commentId) return false
        // Also filter from replies
        if (c.replies) {
          c.replies = c.replies.filter(r => r.id !== commentId)
        }
        return true
      }))
      setStats({ ...stats, total: stats.total - 1 })
      showSuccess('コメントを削除しました')
    } catch (err) {
      console.error('Error deleting comment:', err)
      showError('コメントの削除に失敗しました')
    }
  }

  async function togglePin(commentId: string) {
    try {
      const res = await fetch(`/api/trips/${tripId}/comments/${commentId}/pin`, {
        method: 'PUT',
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        showError(data.error || 'ピン留めの変更に失敗しました')
        return
      }

      const data = await res.json() as { isPinned: boolean }

      // Update comment pin status
      setComments(comments.map(c =>
        c.id === commentId ? { ...c, isPinned: data.isPinned } : c
      ))
      setStats({
        ...stats,
        pinned: stats.pinned + (data.isPinned ? 1 : -1),
      })
      showSuccess(data.isPinned ? 'ピン留めしました' : 'ピン留めを解除しました')
    } catch (err) {
      console.error('Error toggling pin:', err)
      showError('ピン留めの変更に失敗しました')
    }
  }

  // Filter comments by itemId and separate pinned/unpinned
  const generalComments = itemId
    ? comments.filter(c => c.itemId === itemId)
    : comments.filter(c => !c.itemId)

  const pinnedComments = generalComments.filter(c => c.isPinned)
  const unpinnedComments = generalComments.filter(c => !c.isPinned)
  const sortedComments = [...pinnedComments, ...unpinnedComments]

  if (loading) {
    return (
      <section className="comment-section">
        <div className="comment-loading">読み込み中...</div>
      </section>
    )
  }

  return (
    <section className="comment-section no-print">
      <div className="comment-section-header">
        <h2 className="comment-section-title">
          {itemId ? 'コメント' : 'ディスカッション'}
        </h2>
        {stats.total > 0 && (
          <span className="comment-section-count">{stats.total}件</span>
        )}
      </div>

      {/* Comment form */}
      {user ? (
        <form className="comment-form" onSubmit={submitComment}>
          <div className="comment-form-header">
            <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="small" />
            <span className="comment-form-user">{user.name || user.email || '匿名'}</span>
          </div>
          <textarea
            className="input textarea comment-textarea"
            placeholder={itemId ? 'このアイテムにコメント...' : '旅程についてコメント...'}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          <div className="comment-form-actions">
            <button
              type="submit"
              className="btn-filled"
              disabled={submitting || !newComment.trim()}
            >
              {submitting ? '投稿中...' : 'コメントを投稿'}
            </button>
          </div>
        </form>
      ) : (
        <div className="comment-login-prompt">
          <p>コメントするには<Link to="/login">ログイン</Link>してください</p>
        </div>
      )}

      {/* Comments list */}
      {sortedComments.length > 0 ? (
        <div className="comment-list">
          {sortedComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={user?.id || null}
              isOwner={isOwner}
              onEdit={editComment}
              onDelete={deleteComment}
              onReply={setReplyingTo}
              onPin={isOwner && !token ? togglePin : undefined}
              replyingTo={replyingTo}
              replyContent={replyContent}
              setReplyContent={setReplyContent}
              onSubmitReply={submitReply}
              submitting={submitting}
            />
          ))}
        </div>
      ) : (
        <div className="comment-empty">
          {itemId ? 'このアイテムにはまだコメントがありません' : 'まだコメントがありません'}
        </div>
      )}
    </section>
  )
}
