import type { CSSProperties } from 'react'

type SkeletonVariant = 'text' | 'title' | 'image' | 'card' | 'button'

interface SkeletonProps {
  /** Skeleton variant type */
  variant?: SkeletonVariant
  /** Custom width (CSS value) */
  width?: string | number
  /** Custom height (CSS value) */
  height?: string | number
  /** Custom border radius (CSS value) */
  borderRadius?: string | number
  /** Additional CSS class names */
  className?: string
  /** Additional inline styles */
  style?: CSSProperties
}

const variantDefaults: Record<SkeletonVariant, { width: string; height: string; borderRadius: string }> = {
  text: { width: '100%', height: '14px', borderRadius: '4px' },
  title: { width: '200px', height: '24px', borderRadius: '4px' },
  image: { width: '100%', height: '160px', borderRadius: '8px' },
  card: { width: '100%', height: '80px', borderRadius: '10px' },
  button: { width: '100px', height: '40px', borderRadius: '10px' },
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  borderRadius,
  className = '',
  style = {},
}: SkeletonProps) {
  const defaults = variantDefaults[variant]

  const combinedStyle: CSSProperties = {
    width: width ?? defaults.width,
    height: height ?? defaults.height,
    borderRadius: borderRadius ?? defaults.borderRadius,
    ...style,
  }

  return (
    <div
      className={`skeleton skeleton-${variant} ${className}`}
      style={combinedStyle}
    />
  )
}

// Convenience components for common patterns

interface SkeletonTripCardProps {
  className?: string
}

export function SkeletonTripCard({ className = '' }: SkeletonTripCardProps) {
  return (
    <div className={`skeleton-trip-card ${className}`}>
      <Skeleton variant="text" width="70%" height="18px" />
      <Skeleton variant="text" width="40%" height="14px" style={{ marginTop: '8px' }} />
    </div>
  )
}

interface SkeletonTimelineItemProps {
  className?: string
}

export function SkeletonTimelineItem({ className = '' }: SkeletonTimelineItemProps) {
  return (
    <div className={`skeleton-timeline-item ${className}`}>
      <Skeleton variant="text" width="48px" height="14px" />
      <div className="skeleton-timeline-content">
        <Skeleton variant="text" width="60%" height="16px" />
        <Skeleton variant="text" width="80%" height="12px" style={{ marginTop: '6px' }} />
      </div>
    </div>
  )
}

interface SkeletonHeroProps {
  withCover?: boolean
  className?: string
}

export function SkeletonHero({ withCover = false, className = '' }: SkeletonHeroProps) {
  return (
    <div className={`skeleton-hero ${withCover ? 'skeleton-hero-with-cover' : ''} ${className}`}>
      <Skeleton variant="title" width="200px" height="28px" />
      <Skeleton variant="text" width="140px" height="16px" style={{ marginTop: '12px' }} />
      <div className="skeleton-hero-actions">
        <Skeleton variant="button" width="56px" height="32px" />
        <Skeleton variant="button" width="56px" height="32px" />
        <Skeleton variant="button" width="56px" height="32px" />
      </div>
    </div>
  )
}

interface SkeletonDaySectionProps {
  itemCount?: number
  className?: string
}

export function SkeletonDaySection({ itemCount = 3, className = '' }: SkeletonDaySectionProps) {
  return (
    <div className={`skeleton-day-section ${className}`}>
      <div className="skeleton-day-header">
        <Skeleton variant="text" width="60px" height="14px" />
        <Skeleton variant="text" width="80px" height="12px" style={{ marginLeft: '12px' }} />
      </div>
      {Array.from({ length: itemCount }).map((_, i) => (
        <SkeletonTimelineItem key={i} />
      ))}
    </div>
  )
}

interface SkeletonAlbumGridProps {
  count?: number
  className?: string
}

export function SkeletonAlbumGrid({ count = 4, className = '' }: SkeletonAlbumGridProps) {
  return (
    <div className={`skeleton-album-grid ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="image" className="skeleton-album-item" />
      ))}
    </div>
  )
}
