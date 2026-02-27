import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { EmbedPage } from './pages/EmbedPage'
import { GalleryPage } from './pages/GalleryPage'
import { GalleryDetailPage } from './pages/GalleryDetailPage'
import { SavedTripsPage } from './pages/SavedTripsPage'
import { ComparePage } from './pages/ComparePage'
import { OfflineIndicator } from './components/OfflineIndicator'

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
            <Routes>
              {/* 認証不要のページ */}
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/s/:token" element={<SharedTripPage />} />
              <Route path="/invite/:token" element={<InviteAcceptPage />} />
              <Route path="/embed/:id" element={<EmbedPage />} />

              {/* メインレイアウト配下のページ */}
              <Route element={<Layout />}>
                <Route path="/trips" element={<TripListPage />} />
                <Route path="/trips/:id" element={<TripViewPage />} />
                <Route path="/trips/:id/edit" element={<TripEditPage />} />
                <Route path="/trips/:id/album" element={<AlbumPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/gallery/saved" element={<SavedTripsPage />} />
                <Route path="/gallery/:id" element={<GalleryDetailPage />} />
                <Route path="/compare/:groupId" element={<ComparePage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/feedback" element={<FeedbackListPage />} />
              </Route>
            </Routes>
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </ColorModeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
