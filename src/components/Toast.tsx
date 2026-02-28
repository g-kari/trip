import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { ToastContext } from '../contexts/ToastContext'
import { setErrorCallback, setupGlobalErrorHandlers } from '../utils/errorHandler'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message, type }])

    // Auto remove after 5 seconds for errors, 4 seconds for others
    const duration = type === 'error' ? 5000 : 4000
    setTimeout(() => removeToast(id), duration)
  }, [removeToast])

  const showError = useCallback((message: string) => {
    showToast(message, 'error')
  }, [showToast])

  const showSuccess = useCallback((message: string) => {
    showToast(message, 'success')
  }, [showToast])

  // Register global error callback and setup handlers
  useEffect(() => {
    setErrorCallback(showError)
    setupGlobalErrorHandlers()

    return () => {
      setErrorCallback(null)
    }
  }, [showError])

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="true">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            role="alert"
            onClick={() => removeToast(toast.id)}
          >
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" aria-label="閉じる">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
