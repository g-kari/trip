import { describe, it, expect } from 'vitest'
import {
  getSessionIdFromCookie,
  createSessionCookie,
  createLogoutCookie,
} from './session'

describe('getSessionIdFromCookie', () => {
  it('returns null for null header', () => {
    expect(getSessionIdFromCookie(null)).toBeNull()
  })

  it('extracts session ID from simple cookie', () => {
    expect(getSessionIdFromCookie('session=abc123')).toBe('abc123')
  })

  it('extracts session ID from multiple cookies', () => {
    expect(getSessionIdFromCookie('other=value; session=abc123; third=xyz')).toBe('abc123')
  })

  it('returns null when session cookie is not present', () => {
    expect(getSessionIdFromCookie('other=value; another=test')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(getSessionIdFromCookie('')).toBeNull()
  })

  it('handles cookie with UUID value', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(getSessionIdFromCookie(`session=${uuid}`)).toBe(uuid)
  })
})

describe('createSessionCookie', () => {
  it('creates cookie with default max age (30 days)', () => {
    const cookie = createSessionCookie('test-session-id')
    expect(cookie).toBe(
      'session=test-session-id; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000'
    )
  })

  it('creates cookie with custom max age', () => {
    const cookie = createSessionCookie('test-session-id', 7)
    expect(cookie).toContain('Max-Age=604800')
  })

  it('includes HttpOnly flag', () => {
    const cookie = createSessionCookie('id')
    expect(cookie).toContain('HttpOnly')
  })

  it('includes Secure flag', () => {
    const cookie = createSessionCookie('id')
    expect(cookie).toContain('Secure')
  })

  it('includes SameSite=Lax', () => {
    const cookie = createSessionCookie('id')
    expect(cookie).toContain('SameSite=Lax')
  })
})

describe('createLogoutCookie', () => {
  it('creates cookie with Max-Age=0', () => {
    const cookie = createLogoutCookie()
    expect(cookie).toContain('Max-Age=0')
  })

  it('clears the session value', () => {
    const cookie = createLogoutCookie()
    expect(cookie).toContain('session=;')
  })

  it('includes security flags', () => {
    const cookie = createLogoutCookie()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })
})
