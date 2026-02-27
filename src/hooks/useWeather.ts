import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

export type WeatherData = {
  available: boolean
  date: string
  weatherCode: number
  description: string
  icon: string
  temperatureMax?: number
  temperatureMin?: number
}

type GeocodeResult = {
  found: boolean
  latitude?: number
  longitude?: number
  displayName?: string
  reason?: string
}

// Cache for geocode results (location name -> coordinates)
const geocodeCache = new Map<string, GeocodeResult>()

// Cache for weather data (lat,lon,date -> weather)
const weatherCache = new Map<string, WeatherData>()

// Fetch coordinates from location name
async function fetchGeocode(location: string): Promise<GeocodeResult> {
  const cached = geocodeCache.get(location.toLowerCase())
  if (cached) {
    return cached
  }

  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(location)}`)
    const data = await response.json() as GeocodeResult

    geocodeCache.set(location.toLowerCase(), data)
    return data
  } catch (error) {
    console.error('Geocode fetch error:', error)
    return { found: false, reason: 'Network error' }
  }
}

// Fetch weather data for coordinates and date
async function fetchWeather(lat: number, lon: number, date: string): Promise<WeatherData | null> {
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)},${date}`
  const cached = weatherCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const response = await fetch(`/api/weather?lat=${lat}&lon=${lon}&date=${date}`)
    const data = await response.json() as WeatherData

    if (data.available) {
      weatherCache.set(cacheKey, data)
    }

    return data
  } catch (error) {
    console.error('Weather fetch error:', error)
    return null
  }
}

// Check if the request should be made
function shouldFetchWeather(location: string | null, date: string | null): boolean {
  if (!location || !date) {
    return false
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false
  }

  // Check if date is within reasonable range
  const targetDate = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  targetDate.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < -7 || diffDays > 16) {
    return false
  }

  return true
}

// Hook to get weather for a specific location and date
export function useWeather(location: string | null, date: string | null) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Memoize whether we should fetch
  const shouldFetch = useMemo(() => shouldFetchWeather(location, date), [location, date])

  useEffect(() => {
    // Only proceed if we should fetch
    if (!shouldFetch) {
      // Reset state only if there's something to reset
      if (weather !== null || loading || error !== null) {
        setWeather(null)
        setLoading(false)
        setError(null)
      }
      return
    }

    // Abort previous request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()

    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadWeather() {
      try {
        // First, get coordinates for the location
        const geocode = await fetchGeocode(location!)

        if (cancelled) return

        if (!geocode.found || geocode.latitude === undefined || geocode.longitude === undefined) {
          setWeather(null)
          setLoading(false)
          return
        }

        // Then get weather for those coordinates
        const weatherData = await fetchWeather(geocode.latitude, geocode.longitude, date!)

        if (cancelled) return

        setWeather(weatherData)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error('Weather load error:', err)
        setError('Failed to load weather')
        setLoading(false)
      }
    }

    loadWeather()

    return () => {
      cancelled = true
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetch, location, date])

  return { weather, loading, error }
}

// Hook to get weather for multiple locations/dates (batch)
type WeatherRequest = {
  id: string
  location: string
  date: string
}

type WeatherResult = {
  id: string
  weather: WeatherData | null
  loading: boolean
}

export function useWeatherBatch(requests: WeatherRequest[]) {
  const [results, setResults] = useState<Map<string, WeatherResult>>(new Map())

  const loadWeather = useCallback(async (request: WeatherRequest) => {
    const { id, location, date } = request

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return
    }

    // Check if date is within range
    const targetDate = new Date(date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    targetDate.setHours(0, 0, 0, 0)
    const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < -7 || diffDays > 16) {
      return
    }

    setResults(prev => {
      const next = new Map(prev)
      next.set(id, { id, weather: null, loading: true })
      return next
    })

    try {
      const geocode = await fetchGeocode(location)

      if (!geocode.found || geocode.latitude === undefined || geocode.longitude === undefined) {
        setResults(prev => {
          const next = new Map(prev)
          next.set(id, { id, weather: null, loading: false })
          return next
        })
        return
      }

      const weatherData = await fetchWeather(geocode.latitude, geocode.longitude, date)

      setResults(prev => {
        const next = new Map(prev)
        next.set(id, { id, weather: weatherData, loading: false })
        return next
      })
    } catch (error) {
      console.error('Weather batch load error:', error)
      setResults(prev => {
        const next = new Map(prev)
        next.set(id, { id, weather: null, loading: false })
        return next
      })
    }
  }, [])

  useEffect(() => {
    // Load weather for each request that we don't have yet
    requests.forEach(request => {
      const existing = results.get(request.id)
      if (!existing && request.location) {
        loadWeather(request)
      }
    })
  }, [requests, results, loadWeather])

  const getWeather = useCallback((id: string): WeatherResult | undefined => {
    return results.get(id)
  }, [results])

  return { getWeather, results }
}

// Helper to extract first area/location from items for a day
export function getFirstLocationForDay(items: Array<{ area: string | null }>): string | null {
  for (const item of items) {
    if (item.area) {
      return item.area
    }
  }
  return null
}
