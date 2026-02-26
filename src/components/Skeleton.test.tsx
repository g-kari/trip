import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Skeleton,
  SkeletonTripCard,
  SkeletonTimelineItem,
  SkeletonHero,
  SkeletonDaySection,
  SkeletonAlbumGrid,
} from './Skeleton'

describe('Skeleton', () => {
  describe('default variant (text)', () => {
    it('renders with default text variant', () => {
      const { container } = render(<Skeleton />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toBeInTheDocument()
      expect(skeleton).toHaveClass('skeleton-text')
    })

    it('applies default text dimensions', () => {
      const { container } = render(<Skeleton />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '100%', height: '14px', borderRadius: '4px' })
    })
  })

  describe('title variant', () => {
    it('renders with title variant class', () => {
      const { container } = render(<Skeleton variant="title" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveClass('skeleton-title')
    })

    it('applies title default dimensions', () => {
      const { container } = render(<Skeleton variant="title" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '200px', height: '24px', borderRadius: '4px' })
    })
  })

  describe('image variant', () => {
    it('renders with image variant class', () => {
      const { container } = render(<Skeleton variant="image" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveClass('skeleton-image')
    })

    it('applies image default dimensions', () => {
      const { container } = render(<Skeleton variant="image" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '100%', height: '160px', borderRadius: '8px' })
    })
  })

  describe('card variant', () => {
    it('renders with card variant class', () => {
      const { container } = render(<Skeleton variant="card" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveClass('skeleton-card')
    })

    it('applies card default dimensions', () => {
      const { container } = render(<Skeleton variant="card" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '100%', height: '80px', borderRadius: '10px' })
    })
  })

  describe('button variant', () => {
    it('renders with button variant class', () => {
      const { container } = render(<Skeleton variant="button" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveClass('skeleton-button')
    })

    it('applies button default dimensions', () => {
      const { container } = render(<Skeleton variant="button" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '100px', height: '40px', borderRadius: '10px' })
    })
  })

  describe('custom props', () => {
    it('allows custom width override', () => {
      const { container } = render(<Skeleton width="50%" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '50%' })
    })

    it('allows custom height override', () => {
      const { container } = render(<Skeleton height="32px" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ height: '32px' })
    })

    it('allows custom borderRadius override', () => {
      const { container } = render(<Skeleton borderRadius="16px" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ borderRadius: '16px' })
    })

    it('allows numeric width', () => {
      const { container } = render(<Skeleton width={200} />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ width: '200px' })
    })

    it('applies custom className', () => {
      const { container } = render(<Skeleton className="custom-class" />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveClass('custom-class')
    })

    it('applies additional inline styles', () => {
      const { container } = render(<Skeleton style={{ marginTop: '10px' }} />)
      const skeleton = container.querySelector('.skeleton')
      expect(skeleton).toHaveStyle({ marginTop: '10px' })
    })
  })
})

describe('SkeletonTripCard', () => {
  it('renders the trip card skeleton', () => {
    const { container } = render(<SkeletonTripCard />)
    const card = container.querySelector('.skeleton-trip-card')
    expect(card).toBeInTheDocument()
  })

  it('contains skeleton elements', () => {
    const { container } = render(<SkeletonTripCard />)
    const skeletons = container.querySelectorAll('.skeleton')
    expect(skeletons.length).toBe(2)
  })

  it('applies custom className', () => {
    const { container } = render(<SkeletonTripCard className="custom-card" />)
    const card = container.querySelector('.skeleton-trip-card')
    expect(card).toHaveClass('custom-card')
  })
})

describe('SkeletonTimelineItem', () => {
  it('renders the timeline item skeleton', () => {
    const { container } = render(<SkeletonTimelineItem />)
    const item = container.querySelector('.skeleton-timeline-item')
    expect(item).toBeInTheDocument()
  })

  it('contains skeleton elements', () => {
    const { container } = render(<SkeletonTimelineItem />)
    const skeletons = container.querySelectorAll('.skeleton')
    expect(skeletons.length).toBe(3)
  })
})

describe('SkeletonHero', () => {
  it('renders the hero skeleton', () => {
    const { container } = render(<SkeletonHero />)
    const hero = container.querySelector('.skeleton-hero')
    expect(hero).toBeInTheDocument()
  })

  it('renders without cover by default', () => {
    const { container } = render(<SkeletonHero />)
    const hero = container.querySelector('.skeleton-hero')
    expect(hero).not.toHaveClass('skeleton-hero-with-cover')
  })

  it('renders with cover when specified', () => {
    const { container } = render(<SkeletonHero withCover />)
    const hero = container.querySelector('.skeleton-hero')
    expect(hero).toHaveClass('skeleton-hero-with-cover')
  })

  it('contains action buttons', () => {
    const { container } = render(<SkeletonHero />)
    const actions = container.querySelector('.skeleton-hero-actions')
    expect(actions).toBeInTheDocument()
    const buttons = actions?.querySelectorAll('.skeleton-button')
    expect(buttons?.length).toBe(3)
  })
})

describe('SkeletonDaySection', () => {
  it('renders the day section skeleton', () => {
    const { container } = render(<SkeletonDaySection />)
    const section = container.querySelector('.skeleton-day-section')
    expect(section).toBeInTheDocument()
  })

  it('renders default 3 timeline items', () => {
    const { container } = render(<SkeletonDaySection />)
    const items = container.querySelectorAll('.skeleton-timeline-item')
    expect(items.length).toBe(3)
  })

  it('renders custom item count', () => {
    const { container } = render(<SkeletonDaySection itemCount={5} />)
    const items = container.querySelectorAll('.skeleton-timeline-item')
    expect(items.length).toBe(5)
  })
})

describe('SkeletonAlbumGrid', () => {
  it('renders the album grid skeleton', () => {
    const { container } = render(<SkeletonAlbumGrid />)
    const grid = container.querySelector('.skeleton-album-grid')
    expect(grid).toBeInTheDocument()
  })

  it('renders default 4 album items', () => {
    const { container } = render(<SkeletonAlbumGrid />)
    const items = container.querySelectorAll('.skeleton-album-item')
    expect(items.length).toBe(4)
  })

  it('renders custom count', () => {
    const { container } = render(<SkeletonAlbumGrid count={6} />)
    const items = container.querySelectorAll('.skeleton-album-item')
    expect(items.length).toBe(6)
  })
})
