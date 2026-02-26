// ICS (iCalendar) file generator for Google Calendar export

interface IcsEvent {
  uid: string
  title: string
  description?: string
  location?: string
  url?: string
  startDate: string // YYYY-MM-DD
  startTime?: string // HH:mm
  endDate?: string // YYYY-MM-DD
  endTime?: string // HH:mm
}

interface IcsCalendar {
  name: string
  events: IcsEvent[]
}

// Format date for ICS (YYYYMMDD or YYYYMMDDTHHmmss)
function formatIcsDate(date: string, time?: string): string {
  const d = date.replace(/-/g, '')
  if (time) {
    const t = time.replace(/:/g, '') + '00'
    return `${d}T${t}`
  }
  return d
}

// Escape special characters in ICS text
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// Fold long lines (ICS spec requires lines < 75 chars)
function foldLine(line: string): string {
  const maxLen = 75
  if (line.length <= maxLen) return line

  const lines: string[] = []
  let remaining = line

  while (remaining.length > maxLen) {
    lines.push(remaining.substring(0, maxLen))
    remaining = ' ' + remaining.substring(maxLen)
  }
  if (remaining) {
    lines.push(remaining)
  }

  return lines.join('\r\n')
}

export function generateIcs(calendar: IcsCalendar): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//旅程//trip.0g0.workers.dev//JP',
    `X-WR-CALNAME:${escapeIcsText(calendar.name)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const event of calendar.events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${event.uid}@trip.0g0.workers.dev`)
    lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(11, 16))}Z`)

    // Start date/time
    if (event.startTime) {
      lines.push(`DTSTART:${formatIcsDate(event.startDate, event.startTime)}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.startDate)}`)
    }

    // End date/time
    if (event.endDate && event.endTime) {
      lines.push(`DTEND:${formatIcsDate(event.endDate, event.endTime)}`)
    } else if (event.endTime && event.startTime) {
      lines.push(`DTEND:${formatIcsDate(event.startDate, event.endTime)}`)
    } else if (event.endDate) {
      // For all-day events, end date should be the next day
      const end = new Date(event.endDate)
      end.setDate(end.getDate() + 1)
      lines.push(`DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, '')}`)
    }

    lines.push(foldLine(`SUMMARY:${escapeIcsText(event.title)}`))

    if (event.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeIcsText(event.description)}`))
    }

    if (event.location) {
      lines.push(foldLine(`LOCATION:${escapeIcsText(event.location)}`))
    }

    if (event.url) {
      lines.push(foldLine(`URL:${event.url}`))
    }

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  return lines.join('\r\n')
}

// Build ICS data from trip
interface TripDay {
  id: string
  date: string
}

interface TripItem {
  id: string
  dayId: string
  title: string
  area: string | null
  timeStart: string | null
  timeEnd: string | null
  note: string | null
  cost: number | null
  mapUrl?: string | null
}

interface TripData {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  days: TripDay[]
  items: TripItem[]
}

export function buildTripIcs(trip: TripData): string {
  const events: IcsEvent[] = []

  // Create a map of day id to date
  const dayDateMap = new Map<string, string>()
  for (const day of trip.days) {
    dayDateMap.set(day.id, day.date)
  }

  // Create events for each item
  for (const item of trip.items) {
    const date = dayDateMap.get(item.dayId)
    if (!date) continue

    const descParts: string[] = []
    if (item.note) descParts.push(item.note)
    if (item.cost) descParts.push(`費用: ¥${item.cost.toLocaleString()}`)

    events.push({
      uid: item.id,
      title: item.title,
      startDate: date,
      startTime: item.timeStart || undefined,
      endTime: item.timeEnd || undefined,
      location: item.area || undefined,
      url: item.mapUrl || undefined,
      description: descParts.length > 0 ? descParts.join('\n') : undefined,
    })
  }

  // Sort events by date and time
  events.sort((a, b) => {
    const dateCompare = a.startDate.localeCompare(b.startDate)
    if (dateCompare !== 0) return dateCompare
    if (a.startTime && b.startTime) {
      return a.startTime.localeCompare(b.startTime)
    }
    return 0
  })

  return generateIcs({
    name: trip.title,
    events,
  })
}
