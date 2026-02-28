import { useMemo, useState } from 'react'
import type { Item } from '../types'

type MapEmbedProps = {
  items: Item[]
  className?: string
}

type LocationInfo = {
  itemId: string
  title: string
  mapUrl: string
  embedUrl: string
}

/**
 * Extract embed URL from various Google Maps URL formats
 * Supports:
 * - https://www.google.com/maps/place/...
 * - https://maps.google.com/maps?q=...
 * - https://goo.gl/maps/...
 * - https://maps.app.goo.gl/...
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function extractEmbedUrl(mapUrl: string): string | null {
  try {
    const url = new URL(mapUrl)

    // Handle Google Maps place URLs
    // Format: https://www.google.com/maps/place/PLACE_NAME/@LAT,LNG,...
    if (url.hostname.includes('google.com') && url.pathname.includes('/place/')) {
      // Extract place name from URL path
      const pathMatch = url.pathname.match(/\/place\/([^/@]+)/)
      if (pathMatch) {
        const placeName = decodeURIComponent(pathMatch[1].replace(/\+/g, ' '))
        return `https://maps.google.com/maps?q=${encodeURIComponent(placeName)}&output=embed`
      }
    }

    // Handle Google Maps search URLs
    // Format: https://www.google.com/maps/search/...
    if (url.hostname.includes('google.com') && url.pathname.includes('/search/')) {
      const pathMatch = url.pathname.match(/\/search\/([^/@]+)/)
      if (pathMatch) {
        const searchQuery = decodeURIComponent(pathMatch[1].replace(/\+/g, ' '))
        return `https://maps.google.com/maps?q=${encodeURIComponent(searchQuery)}&output=embed`
      }
    }

    // Handle Google Maps URLs with q parameter
    // Format: https://maps.google.com/maps?q=...
    // Format: https://www.google.com/maps?q=...
    if (url.hostname.includes('google.com') && url.searchParams.has('q')) {
      const query = url.searchParams.get('q')
      if (query) {
        return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
      }
    }

    // Handle Google Maps URLs with coordinates in path
    // Format: https://www.google.com/maps/@LAT,LNG,ZOOM...
    if (url.hostname.includes('google.com') && url.pathname.includes('/@')) {
      const coordMatch = url.pathname.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
      if (coordMatch) {
        const [, lat, lng] = coordMatch
        return `https://maps.google.com/maps?q=${lat},${lng}&output=embed`
      }
    }

    // Handle short Google Maps links (goo.gl/maps or maps.app.goo.gl)
    // These are shortened URLs, we'll use them directly with query fallback
    if (url.hostname === 'goo.gl' || url.hostname === 'maps.app.goo.gl') {
      // For shortened URLs, we need to extract any available info
      // Since we can't resolve shortened URLs on client side, use the full URL as query
      return null // Can't embed shortened URLs directly
    }

    // Fallback: try to use the URL as a search query
    // Extract any text that might be a location name
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1]
      if (lastPart && !lastPart.startsWith('@')) {
        const decoded = decodeURIComponent(lastPart.replace(/\+/g, ' '))
        return `https://maps.google.com/maps?q=${encodeURIComponent(decoded)}&output=embed`
      }
    }

    return null
  } catch {
    // Invalid URL
    return null
  }
}

/**
 * MapEmbed component - displays Google Maps iframe for trip items
 * Shows a map section with embedded Google Maps for items that have mapUrl
 */
export function MapEmbed({ items, className = '' }: MapEmbedProps) {
  const [selectedLocationIndex, setSelectedLocationIndex] = useState(0)

  // Extract locations with valid embed URLs
  const locations: LocationInfo[] = useMemo(() => {
    return items
      .filter((item) => item.mapUrl && item.mapUrl.trim() !== '')
      .map((item) => {
        const embedUrl = extractEmbedUrl(item.mapUrl!)
        return {
          itemId: item.id,
          title: item.title,
          mapUrl: item.mapUrl!,
          embedUrl: embedUrl || '',
        }
      })
      .filter((loc) => loc.embedUrl !== '')
  }, [items])

  // No locations to show
  if (locations.length === 0) {
    return null
  }

  const selectedLocation = locations[selectedLocationIndex] || locations[0]

  return (
    <section className={`map-embed-section ${className}`}>
      <h3 className="map-embed-title">訪問地マップ</h3>

      {/* Location list */}
      {locations.length > 1 && (
        <div className="map-embed-locations">
          {locations.map((loc, index) => (
            <button
              key={loc.itemId}
              className={`map-embed-location-btn ${index === selectedLocationIndex ? 'active' : ''}`}
              onClick={() => setSelectedLocationIndex(index)}
            >
              {loc.title}
            </button>
          ))}
        </div>
      )}

      {/* Map iframe */}
      {isSafeUrl(selectedLocation.embedUrl) && (
        <div className="map-embed-container">
          <iframe
            src={selectedLocation.embedUrl}
            className="map-embed-iframe"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={`${selectedLocation.title}の地図`}
          />
        </div>
      )}

      {/* Link to Google Maps */}
      {isSafeUrl(selectedLocation.mapUrl) && (
        <div className="map-embed-actions">
          <a
            href={selectedLocation.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="map-embed-link"
          >
            Google Mapsで開く
          </a>
        </div>
      )}
    </section>
  )
}
