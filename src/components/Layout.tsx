import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ThemeToggle } from './ThemeToggle'

export function Layout() {
  const { user, loading } = useAuth()

  return (
    <div className="app">
      <header className="header no-print">
        <div className="header-content">
          <Link to="/" className="header-logo" style={{ textDecoration: 'none', color: 'inherit' }}>
            旅程
          </Link>

          {!loading && user && (
            <nav className="header-nav">
              <Link to="/trips" className="header-nav-link">
                旅程一覧
              </Link>
              <Link to="/stats" className="header-nav-link">
                統計
              </Link>
            </nav>
          )}

          <div className="header-right">
            <ThemeToggle />
            {!loading && (
              <div className="user-menu">
                {user ? (
                  <Link to="/profile" className="user-profile-link">
                    {user.avatarUrl && (
                      <img src={user.avatarUrl} alt="" className="user-avatar" />
                    )}
                    <span className="user-name">{user.name || user.email}</span>
                  </Link>
                ) : (
                  <Link to="/login" className="btn-text">
                    ログイン
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer no-print">
        <span className="footer-text">旅程</span>
      </footer>
    </div>
  )
}
