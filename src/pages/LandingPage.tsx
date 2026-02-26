import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function LandingPage() {
  const { user, loading } = useAuth()

  // If logged in, redirect to trips
  if (!loading && user) {
    return (
      <div className="app">
        <header className="header">
          <span className="header-logo">旅程</span>
        </header>
        <main className="main">
          <div className="hero">
            <p className="hero-subtitle">リダイレクト中...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <span className="header-logo">旅程</span>
      </header>

      <main className="main">
        <section className="landing-hero">
          <h1 className="landing-title">旅程</h1>
          <p className="landing-tagline">
            旅の計画を、<br />
            静かに、丁寧に。
          </p>
        </section>

        <section className="landing-features">
          <div className="feature">
            <span className="feature-icon">📅</span>
            <h3 className="feature-title">日程を整理</h3>
            <p className="feature-desc">
              日ごとのタイムラインで<br />
              予定を見やすく管理
            </p>
          </div>

          <div className="feature">
            <span className="feature-icon">📍</span>
            <h3 className="feature-title">場所をメモ</h3>
            <p className="feature-desc">
              行きたい場所の<br />
              地図リンクや費用を記録
            </p>
          </div>

          <div className="feature">
            <span className="feature-icon">🔗</span>
            <h3 className="feature-title">共有も簡単</h3>
            <p className="feature-desc">
              リンク一つで<br />
              旅の仲間に共有
            </p>
          </div>
        </section>

        <section className="landing-cta">
          {loading ? (
            <p className="landing-loading">読み込み中...</p>
          ) : (
            <>
              <Link to="/login" className="btn-filled landing-btn">
                はじめる
              </Link>
              <p className="landing-note">
                Googleアカウントで簡単ログイン
              </p>
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        <span className="footer-text">旅程 — しずかに計画する旅</span>
        <Link to="/contact" className="footer-link">お問い合わせ</Link>
      </footer>
    </div>
  )
}
