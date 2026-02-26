export type User = {
  id: string
  provider: 'google' | 'line'
  providerId: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  createdAt: string
}

export type Session = {
  id: string
  userId: string
  expiresAt: string
}

export type GoogleUserInfo = {
  id: string
  email: string
  name: string
  picture: string
}
