import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import './App.css'
import { ErrorBoundary } from './components/ErrorBoundary'
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
import { AlbumPage } from './pages/AlbumPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* 認証不要のページ */}
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/s/:token" element={<SharedTripPage />} />

              {/* メインレイアウト配下のページ */}
              <Route element={<Layout />}>
                <Route path="/trips" element={<TripListPage />} />
                <Route path="/trips/:id" element={<TripViewPage />} />
                <Route path="/trips/:id/edit" element={<TripEditPage />} />
                <Route path="/trips/:id/album" element={<AlbumPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
