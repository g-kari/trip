import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LandingPage } from './LandingPage'

export function HomePage() {
  const { user, loading } = useAuth()

  if (loading) {
    return <LandingPage />
  }

  if (user) {
    return <Navigate to="/trips" replace />
  }

  return <LandingPage />
}
