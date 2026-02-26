/**
 * LINE OAuth2 authentication functions
 *
 * Environment variables required:
 * - LINE_CHANNEL_ID: LINE Login channel ID from LINE Developers Console
 * - LINE_CHANNEL_SECRET: LINE Login channel secret from LINE Developers Console
 *
 * LINE Login setup:
 * 1. Create a LINE Login channel at https://developers.line.biz/console/
 * 2. Enable "Web app" in LINE Login settings
 * 3. Add callback URL: https://your-domain.com/api/auth/line/callback
 * 4. Note the Channel ID and Channel secret for environment variables
 */

import type { LineUserInfo } from './types'

const LINE_AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize'
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token'
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile'

export function getLineAuthUrl(
  channelId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: 'profile openid',
  })
  return `${LINE_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(
  code: string,
  channelId: string,
  channelSecret: string,
  redirectUri: string
): Promise<{ access_token: string; id_token?: string }> {
  const response = await fetch(LINE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange code for tokens: ${error}`)
  }

  return response.json()
}

export async function getLineUserInfo(
  accessToken: string
): Promise<LineUserInfo> {
  const response = await fetch(LINE_PROFILE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to get user info from LINE')
  }

  return response.json()
}
