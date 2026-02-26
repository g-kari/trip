import { useState, useCallback, type ReactNode } from 'react'
import { ToastContext } from '../contexts/ToastContext'

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

    // Auto remove after 4 seconds
    setTimeout(() => removeToast(id), 4000)
  }, [removeToast])

  const showError = useCallback((message: string) => {
    showToast(message, 'error')
  }, [showToast])

  const showSuccess = useCallback((message: string) => {
    showToast(message, 'success')
  }, [showToast])

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
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
