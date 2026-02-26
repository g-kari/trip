import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="app">
          <header className="header">
            <span className="header-logo">旅程</span>
          </header>
          <main className="main">
            <div className="error-container">
              <div className="error-icon">!</div>
              <h1 className="error-title">エラーが発生しました</h1>
              <p className="error-message">
                予期せぬエラーが発生しました。<br />
                ページを再読み込みしてください。
              </p>
              <div className="error-actions">
                <button
                  className="btn-filled"
                  onClick={() => window.location.reload()}
                >
                  再読み込み
                </button>
                <button
                  className="btn-outline"
                  onClick={() => window.location.href = '/'}
                >
                  トップに戻る
                </button>
              </div>
            </div>
          </main>
        </div>
      )
    }

    return this.props.children
  }
}
