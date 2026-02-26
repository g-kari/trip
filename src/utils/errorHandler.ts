// Global error handler for API calls and unhandled errors

type ErrorCallback = (message: string) => void

let errorCallback: ErrorCallback | null = null

// Set the callback for showing errors (called from ToastProvider)
export function setErrorCallback(callback: ErrorCallback | null) {
  errorCallback = callback
}

// Show error to user
export function showError(message: string) {
  if (errorCallback) {
    errorCallback(message)
  } else {
    // Fallback: use alert if toast is not available
    console.error('Error:', message)
  }
}

// Handle API response errors
export async function handleApiError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string }
    return data.error || `エラーが発生しました (${response.status})`
  } catch {
    return `エラーが発生しました (${response.status})`
  }
}

// Wrapper for fetch with automatic error handling
export async function apiFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(url, options)

    if (!response.ok) {
      const errorMessage = await handleApiError(response)
      showError(errorMessage)
      throw new Error(errorMessage)
    }

    return response
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      showError('ネットワークエラー: サーバーに接続できません')
    }
    throw error
  }
}

// Setup global error handlers
export function setupGlobalErrorHandlers() {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason)

    // Don't show network errors twice (already handled in apiFetch)
    if (event.reason?.message !== 'Failed to fetch') {
      const message = event.reason?.message || '予期せぬエラーが発生しました'
      showError(message)
    }

    // Prevent the default browser handling
    event.preventDefault()
  })

  // Handle global errors
  window.addEventListener('error', (event) => {
    console.error('Global error:', event.error)

    // Only show user-facing errors for significant issues
    if (event.error?.message && !event.error.message.includes('ResizeObserver')) {
      showError('エラーが発生しました。ページを再読み込みしてください。')
    }
  })
}
