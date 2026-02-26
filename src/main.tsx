import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ColorModeProvider } from './components/ColorModeProvider'
import { ToastProvider } from './components/Toast'
import { AuthProvider } from './components/AuthProvider'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { TripListPage } from './pages/TripListPage'
import { TripViewPage } from './pages/TripViewPage'
import { TripEditPage } from './pages/TripEditPage'
import { SharedTripPage } from './pages/SharedTripPage'
import { LoginPage } from './pages/LoginPage'
import { ContactPage } from './pages/ContactPage'
import { FeedbackListPage } from './pages/FeedbackListPage'
import { AlbumPage } from './pages/AlbumPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { StatsPage } from './pages/StatsPage'
import { ProfilePage } from './pages/ProfilePage'
import { InviteAcceptPage } from './pages/InviteAcceptPage'
import { OfflineIndicator } from './components/OfflineIndicator'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ColorModeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
            <OfflineIndicator />
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
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ColorModeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
