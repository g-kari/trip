import type { WeatherData } from '../hooks/useWeather'

type WeatherIconProps = {
  weather: WeatherData | null
  loading?: boolean
  showTemperature?: boolean
  size?: 'small' | 'medium' | 'large'
}

// Weather icon SVG components
function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="weather-icon-svg">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function PartlyCloudyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="weather-icon-svg">
      <circle cx="9" cy="9" r="4" fill="var(--color-weather-sun, #f59e0b)" />
      <path d="M9 2v1.5M9 14.5V16M3.22 3.22l1.06 1.06M13.72 13.72l1.06 1.06M2 9h1.5M14.5 9H16M3.22 14.78l1.06-1.06M13.72 4.28l1.06 1.06"
        strokeWidth="1.5" stroke="var(--color-weather-sun, #f59e0b)" fill="none" strokeLinecap="round" />
      <path d="M17 18H7a4 4 0 1 1 0-8h.2a5.5 5.5 0 0 1 10.6 4.2 3 3 0 0 1-.8 5.8z" fill="var(--color-weather-cloud, #94a3b8)" />
    </svg>
  )
}

function CloudyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="weather-icon-svg">
      <path d="M19 18H7a5 5 0 1 1 0-10h.2a6 6 0 0 1 11.6 4.7A3.5 3.5 0 0 1 19 18z" fill="var(--color-weather-cloud, #94a3b8)" />
    </svg>
  )
}

function FogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <path d="M5 10h14M4 14h16M6 18h12" strokeWidth="2" stroke="var(--color-weather-cloud, #94a3b8)" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function DrizzleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <path d="M17 16H6a4 4 0 1 1 0-8h.2a5 5 0 0 1 9.6 3.6 2.5 2.5 0 0 1 1.2 4.4z" fill="var(--color-weather-cloud, #94a3b8)" />
      <path d="M8 19v1M12 19v1M16 19v1" strokeWidth="2" stroke="var(--color-weather-rain, #3b82f6)" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function RainIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <path d="M17 14H6a4 4 0 1 1 0-8h.2a5 5 0 0 1 9.6 3.6 2.5 2.5 0 0 1 1.2 4.4z" fill="var(--color-weather-cloud, #94a3b8)" />
      <path d="M8 17v3M12 17v3M16 17v3" strokeWidth="2" stroke="var(--color-weather-rain, #3b82f6)" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function ShowersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <circle cx="7" cy="6" r="3" fill="var(--color-weather-sun, #f59e0b)" />
      <path d="M7 1v1M7 11v1M3.17 2.17l.71.71M10.12 9.12l.71.71M2 6h1M12 6h1"
        strokeWidth="1" stroke="var(--color-weather-sun, #f59e0b)" fill="none" strokeLinecap="round" />
      <path d="M18 16H8a3 3 0 1 1 0-6h.15a4 4 0 0 1 7.7 2.9 2 2 0 0 1 2.15 3.1z" fill="var(--color-weather-cloud, #94a3b8)" />
      <path d="M10 18v2M14 18v2" strokeWidth="2" stroke="var(--color-weather-rain, #3b82f6)" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function SnowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <path d="M17 14H6a4 4 0 1 1 0-8h.2a5 5 0 0 1 9.6 3.6 2.5 2.5 0 0 1 1.2 4.4z" fill="var(--color-weather-cloud, #94a3b8)" />
      <circle cx="8" cy="18" r="1" fill="var(--color-weather-snow, #60a5fa)" />
      <circle cx="12" cy="18" r="1" fill="var(--color-weather-snow, #60a5fa)" />
      <circle cx="16" cy="18" r="1" fill="var(--color-weather-snow, #60a5fa)" />
      <circle cx="10" cy="21" r="1" fill="var(--color-weather-snow, #60a5fa)" />
      <circle cx="14" cy="21" r="1" fill="var(--color-weather-snow, #60a5fa)" />
    </svg>
  )
}

function ThunderstormIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <path d="M17 12H6a4 4 0 1 1 0-8h.2a5 5 0 0 1 9.6 3.6 2.5 2.5 0 0 1 1.2 4.4z" fill="var(--color-weather-cloud, #64748b)" />
      <path d="M13 12l-3 6h4l-3 6" strokeWidth="2" stroke="var(--color-weather-lightning, #fbbf24)" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UnknownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg">
      <circle cx="12" cy="12" r="8" fill="var(--color-weather-cloud, #94a3b8)" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="white">?</text>
    </svg>
  )
}

function LoadingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="weather-icon-svg weather-loading">
      <circle cx="12" cy="12" r="8" fill="none" stroke="var(--color-border)" strokeWidth="2" />
      <path d="M12 4a8 8 0 0 1 8 8" stroke="var(--color-text-muted)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function getIconComponent(iconType: string) {
  switch (iconType) {
    case 'clear':
      return <ClearIcon />
    case 'partly_cloudy':
      return <PartlyCloudyIcon />
    case 'cloudy':
      return <CloudyIcon />
    case 'fog':
      return <FogIcon />
    case 'drizzle':
      return <DrizzleIcon />
    case 'rain':
      return <RainIcon />
    case 'showers':
      return <ShowersIcon />
    case 'snow':
      return <SnowIcon />
    case 'thunderstorm':
      return <ThunderstormIcon />
    default:
      return <UnknownIcon />
  }
}

export function WeatherIcon({ weather, loading, showTemperature = true, size = 'medium' }: WeatherIconProps) {
  if (loading) {
    return (
      <div className={`weather-badge weather-badge-${size}`}>
        <LoadingIcon />
      </div>
    )
  }

  if (!weather || !weather.available) {
    return null
  }

  return (
    <div className={`weather-badge weather-badge-${size}`} title={weather.description}>
      {getIconComponent(weather.icon)}
      {showTemperature && weather.temperatureMax !== undefined && (
        <span className="weather-temp">
          {Math.round(weather.temperatureMax)}°
        </span>
      )}
    </div>
  )
}

// Compact version for inline display
export function WeatherIconCompact({ weather, loading }: { weather: WeatherData | null, loading?: boolean }) {
  return <WeatherIcon weather={weather} loading={loading} showTemperature={false} size="small" />
}
