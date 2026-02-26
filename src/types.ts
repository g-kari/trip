// Theme types
export type TripTheme = 'quiet' | 'photo'

// Cost categories for budget management
export const COST_CATEGORIES = [
  '交通費',
  '宿泊費',
  '食費',
  '観光・アクティビティ',
  'お土産',
  'その他',
] as const

export type CostCategory = typeof COST_CATEGORIES[number]

// Budget summary for trip
export type BudgetSummary = {
  totalBudget: number | null
  totalSpent: number
  remaining: number | null
  isOverBudget: boolean
  byCategory: {
    category: CostCategory
    amount: number
    percentage: number
  }[]
}

// API response types
export type Trip = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  theme: TripTheme
  coverImageUrl: string | null
  budget: number | null
  isArchived: boolean
  createdAt: string
  days?: Day[]
  items?: Item[]
}

export type DayPhoto = {
  id: string
  photoUrl: string
  uploadedBy: string | null
  uploadedByName: string | null
  uploadedAt: string | null
}

export type Day = {
  id: string
  date: string
  sort: number
  notes: string | null
  photos: DayPhoto[]
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
  costCategory: CostCategory | null
  sort: number
  photoUrl: string | null
  photoUploadedBy: string | null
  photoUploadedByName: string | null
  photoUploadedAt: string | null
}

export type TripFeedback = {
  id: string
  userId: string | null
  name: string
  rating: number
  comment: string | null
  createdAt: string
}

export type FeedbackStats = {
  count: number
  averageRating: number
}
