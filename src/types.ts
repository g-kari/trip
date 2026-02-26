// Theme types
export type TripTheme = 'quiet' | 'photo'

// API response types
export type Trip = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme
  coverImageUrl: string | null
  createdAt: string
  days?: Day[]
  items?: Item[]
}

export type Day = {
  id: string
  date: string
  sort: number
}

export type Item = {
  id: string
  dayId: string
  title: string
  area: string | null
  timeStart: string | null
  timeEnd: string | null
  mapUrl: string | null
  note: string | null
  cost: number | null
  sort: number
}
