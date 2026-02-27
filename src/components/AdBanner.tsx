import { useState, useEffect, useMemo } from 'react'
import { getRandomAd, type NativeAdContent } from '../utils/adUtils'

// Ad slot configuration
type AdSlot = {
  id: string
  type: 'native' | 'banner'
  position: 'list-inline' | 'sidebar' | 'footer'
}

type Props = {
  slot: AdSlot
  className?: string
}

export function AdBanner({ slot, className = '' }: Props) {
  // Memoize slot.id to use as dependency
  const slotId = slot.id
  // Use useMemo to compute ad once per slot.id, avoiding setState in effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ad = useMemo<NativeAdContent>(() => getRandomAd(), [slotId])
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) {
    return null
  }

  // Native ad style for list inline
  if (slot.type === 'native' && slot.position === 'list-inline') {
    return (
      <div className={`ad-native-inline ${className}`}>
        <div className="ad-native-content">
          <div className="ad-native-header">
            <span className="ad-label">広告</span>
            <button
              type="button"
              className="ad-dismiss"
              onClick={() => setDismissed(true)}
              aria-label="広告を閉じる"
            >
              ×
            </button>
          </div>
          <a
            href={ad.linkUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="ad-native-link"
          >
            <div className="ad-native-text">
              <span className="ad-native-title">{ad.title}</span>
              <span className="ad-native-description">{ad.description}</span>
            </div>
            <span className="ad-native-cta">詳しく →</span>
          </a>
          <span className="ad-sponsor">{ad.sponsor}</span>
        </div>
      </div>
    )
  }

  // Banner ad style
  return (
    <div className={`ad-banner ${className}`}>
      <div className="ad-banner-header">
        <span className="ad-label">広告</span>
        <button
          type="button"
          className="ad-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="広告を閉じる"
        >
          ×
        </button>
      </div>
      <a
        href={ad.linkUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="ad-banner-link"
      >
        <span className="ad-banner-title">{ad.title}</span>
        <span className="ad-banner-description">{ad.description}</span>
      </a>
      <span className="ad-sponsor">{ad.sponsor}</span>
    </div>
  )
}

// Google AdSense component (for when AdSense is configured)
type AdSenseProps = {
  adClient: string
  adSlot: string
  adFormat?: 'auto' | 'fluid' | 'rectangle'
  className?: string
}

export function AdSenseUnit({ adClient, adSlot, adFormat = 'auto', className = '' }: AdSenseProps) {
  useEffect(() => {
    // Push ad to AdSense when component mounts
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      // Initialize adsbygoogle array on window if not present (standard AdSense pattern)
      w.adsbygoogle = w.adsbygoogle || []
      w.adsbygoogle.push({})
    } catch (err) {
      console.error('AdSense error:', err)
    }
  }, [])

  return (
    <div className={`adsense-container ${className}`}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={adClient}
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-full-width-responsive="true"
      />
    </div>
  )
}
