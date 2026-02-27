export type User = {
  id: string
  provider: 'google' | 'line'
  providerId: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  createdAt: string
  isPremium?: number       // 1 if user has ever purchased trip slots
  freeSlots?: number       // remaining free trip slots (default 3)
  purchasedSlots?: number  // total purchased slots
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

export type LineUserInfo = {
  userId: string
  displayName: string
  pictureUrl?: string
  statusMessage?: string
}
