import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import './App.css'
import { AuthProvider } from './components/AuthProvider'
import { Layout } from './components/Layout'
import { TripListPage } from './pages/TripListPage'
import { TripViewPage } from './pages/TripViewPage'
import { TripEditPage } from './pages/TripEditPage'
import { SharedTripPage } from './pages/SharedTripPage'
import { LoginPage } from './pages/LoginPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* 認証不要のページ */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/s/:token" element={<SharedTripPage />} />

          {/* メインレイアウト配下のページ */}
          <Route element={<Layout />}>
            <Route path="/" element={<TripListPage />} />
            <Route path="/trips" element={<TripListPage />} />
            <Route path="/trips/:id" element={<TripViewPage />} />
            <Route path="/trips/:id/edit" element={<TripEditPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
