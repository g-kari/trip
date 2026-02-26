import { useState, useEffect } from 'react'

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [showBanner, setShowBanner] = useState(() => !navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      // Show brief "back online" message
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

  if (!showBanner) {
    return null
  }

  return (
    <div className={`offline-indicator ${isOnline ? 'online' : 'offline'}`}>
      <span className="offline-indicator-text">
        {isOnline ? 'オンライン' : 'オフライン'}
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
