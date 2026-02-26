import type { D1Database } from '@cloudflare/workers-types'
import type { User, Session } from './types'

const SESSION_COOKIE_NAME = 'session'
const SESSION_DURATION_DAYS = 30

export function generateId(): string {
  return crypto.randomUUID()
}

export async function createSession(
  db: D1Database,
  userId: string
): Promise<Session> {
  const id = generateId()
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(id, userId, expiresAt)
    .run()

  return { id, userId, expiresAt }
}

export async function getSession(
  db: D1Database,
  sessionId: string
): Promise<Session | null> {
  const session = await db
    .prepare(
      'SELECT id, user_id as userId, expires_at as expiresAt FROM sessions WHERE id = ?'
    )
    .bind(sessionId)
    .first<Session>()

  if (!session) return null

  // Check if expired
  if (new Date(session.expiresAt) < new Date()) {
    await deleteSession(db, sessionId)
    return null
  }

  return session
}

export async function deleteSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run()
}

export async function getUserBySession(
  db: D1Database,
  sessionId: string
): Promise<User | null> {
  const session = await getSession(db, sessionId)
  if (!session) return null

  const user = await db
    .prepare(
      `SELECT id, provider, provider_id as providerId, email, name,
              avatar_url as avatarUrl, created_at as createdAt
       FROM users WHERE id = ?`
    )
    .bind(session.userId)
    .first<User>()

  return user
}

export function getSessionIdFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=')
    if (name === SESSION_COOKIE_NAME) {
      return value
    }
  }
  return null
}

export function createSessionCookie(sessionId: string, maxAgeDays = SESSION_DURATION_DAYS): string {
  const maxAge = maxAgeDays * 24 * 60 * 60
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

export function createLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
