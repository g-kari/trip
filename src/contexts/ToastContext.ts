import { createContext } from 'react'

type ToastType = 'success' | 'error' | 'info'

export interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void
  showError: (message: string) => void
  showSuccess: (message: string) => void
}

export const ToastContext = createContext<ToastContextType | null>(null)
