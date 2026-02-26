import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ThemeToggle } from './ThemeToggle'

export function Layout() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="app">
      <header className="header no-print">
        <div className="header-content">
          <Link to="/" className="header-logo" style={{ textDecoration: 'none', color: 'inherit' }}>
            旅程
          </Link>

          <div className="header-right">
            <ThemeToggle />
            {!loading && (
              <div className="user-menu">
                {user ? (
                  <>
                    {user.avatarUrl && (
                      <img src={user.avatarUrl} alt="" className="user-avatar" />
                    )}
                    <span className="user-name">{user.name || user.email}</span>
                    <button className="btn-text btn-small" onClick={handleLogout}>
                      ログアウト
                    </button>
                  </>
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
