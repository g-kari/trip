import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles/index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ColorModeProvider } from './components/ColorModeProvider'
import { ToastProvider } from './components/Toast'
import { AuthProvider } from './components/AuthProvider'
import { Layout } from './components/Layout'
import { OfflineIndicator } from './components/OfflineIndicator'

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const ContactPage = lazy(() => import('./pages/ContactPage').then(m => ({ default: m.ContactPage })))
const SharedTripPage = lazy(() => import('./pages/SharedTripPage').then(m => ({ default: m.SharedTripPage })))
const InviteAcceptPage = lazy(() => import('./pages/InviteAcceptPage').then(m => ({ default: m.InviteAcceptPage })))
const TripListPage = lazy(() => import('./pages/TripListPage').then(m => ({ default: m.TripListPage })))
const TripViewPage = lazy(() => import('./pages/TripViewPage').then(m => ({ default: m.TripViewPage })))
const TripEditPage = lazy(() => import('./pages/TripEditPage').then(m => ({ default: m.TripEditPage })))
const AlbumPage = lazy(() => import('./pages/AlbumPage').then(m => ({ default: m.AlbumPage })))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage').then(m => ({ default: m.TemplatesPage })))
const StatsPage = lazy(() => import('./pages/StatsPage').then(m => ({ default: m.StatsPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const FeedbackListPage = lazy(() => import('./pages/FeedbackListPage').then(m => ({ default: m.FeedbackListPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ColorModeProvider>
          <ToastProvider>
            <AuthProvider>
              <BrowserRouter>
            <OfflineIndicator />
            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
              <div style={{ width: 32, height: 32, border: '3px solid var(--color-border, #e0d6ca)', borderTopColor: 'var(--color-primary, #3d2e1f)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>}>
            <Routes>
              {/* 認証不要のページ */}
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/s/:token" element={<SharedTripPage />} />
              <Route path="/invite/:token" element={<InviteAcceptPage />} />

              {/* メインレイアウト配下のページ */}
              <Route element={<Layout />}>
                <Route path="/trips" element={<TripListPage />} />
                <Route path="/trips/:id" element={<TripViewPage />} />
                <Route path="/trips/:id/edit" element={<TripEditPage />} />
                <Route path="/trips/:id/album" element={<AlbumPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/feedback" element={<FeedbackListPage />} />
              </Route>
            </Routes>
            </Suspense>
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </ColorModeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
