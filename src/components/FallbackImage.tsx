import { useState } from 'react'

type FallbackImageProps = {
  src: string | null | undefined
  alt: string
  className?: string
  fallbackType?: 'notFound' | 'restricted'
}

export function FallbackImage({ src, alt, className, fallbackType = 'notFound' }: FallbackImageProps) {
  const [error, setError] = useState(false)

  if (!src || error) {
    return (
      <div className={`fallback-image ${className || ''}`}>
        {fallbackType === 'restricted' ? (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            <span>非公開の画像です</span>
          </>
        ) : (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            <span>おやぁ？見当たらない様だ..</span>
          </>
        )}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
    />
  )
}
