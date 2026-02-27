import { describe, it, expect } from 'vitest'
import { getGoogleAuthUrl } from './google'
import { getLineAuthUrl } from './line'

describe('getGoogleAuthUrl', () => {
  const clientId = 'test-client-id'
  const redirectUri = 'https://example.com/callback'
  const state = 'random-state-token'

  it('returns a valid Google OAuth URL', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?')
  })

  it('includes client_id', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('client_id')).toBe(clientId)
  })

  it('includes redirect_uri', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('redirect_uri')).toBe(redirectUri)
  })

  it('includes state', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('state')).toBe(state)
  })

  it('requests code response type', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('response_type')).toBe('code')
  })

  it('requests openid email profile scope', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('scope')).toBe('openid email profile')
  })

  it('sets prompt to select_account', () => {
    const url = getGoogleAuthUrl(clientId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('prompt')).toBe('select_account')
  })
})

describe('getLineAuthUrl', () => {
  const channelId = 'test-channel-id'
  const redirectUri = 'https://example.com/line/callback'
  const state = 'random-state-token'

  it('returns a valid LINE OAuth URL', () => {
    const url = getLineAuthUrl(channelId, redirectUri, state)
    expect(url).toContain('https://access.line.me/oauth2/v2.1/authorize?')
  })

  it('includes client_id as channelId', () => {
    const url = getLineAuthUrl(channelId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('client_id')).toBe(channelId)
  })

  it('includes redirect_uri', () => {
    const url = getLineAuthUrl(channelId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('redirect_uri')).toBe(redirectUri)
  })

  it('includes state', () => {
    const url = getLineAuthUrl(channelId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('state')).toBe(state)
  })

  it('requests code response type', () => {
    const url = getLineAuthUrl(channelId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('response_type')).toBe('code')
  })

  it('requests profile openid scope', () => {
    const url = getLineAuthUrl(channelId, redirectUri, state)
    const params = new URL(url).searchParams
    expect(params.get('scope')).toBe('profile openid')
  })
})
