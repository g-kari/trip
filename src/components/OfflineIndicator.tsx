import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [showBanner, setShowBanner] = useState(() => !navigator.onLine)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r)
    },
    onRegisterError(error) {
      console.error('SW registration error:', error)
    },
  })

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      setShowBanner(true)
      setTimeout(() => setShowBanner(false), 3000)
    }

    function handleOffline() {
      setIsOnline(false)
      setShowBanner(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Show update available banner
  if (needRefresh) {
    return (
      <div className="offline-indicator update">
        <span className="offline-indicator-text">
          新しいバージョンがあります
        </span>
        <button
          className="offline-indicator-update-btn"
          onClick={() => updateServiceWorker(true)}
        >
          更新
        </button>
        <button
          className="offline-indicator-close"
          onClick={() => setNeedRefresh(false)}
          aria-label="閉じる"
        >
          ×
        </button>
      </div>
    )
  }

  if (!showBanner) {
    return null
  }

  return (
    <div className={`offline-indicator ${isOnline ? 'online' : 'offline'}`}>
      <span className="offline-indicator-text">
        {isOnline ? 'オンラインに復帰しました' : 'オフラインです（キャッシュから表示中）'}
      </span>
      {isOnline && (
        <button
          className="offline-indicator-close"
          onClick={() => setShowBanner(false)}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
    </div>
  )
}
