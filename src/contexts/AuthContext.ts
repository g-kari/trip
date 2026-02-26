import { createContext } from 'react'

type User = {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

export type AuthContextType = {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | null>(null)
