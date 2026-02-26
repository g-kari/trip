// User type
export type User = {
  id: string
  name: string | null
  avatarUrl: string | null
}

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

// ============ Expense splitting types ============

// Share type for expense splitting
export type ShareType = 'equal' | 'percentage' | 'amount'

// Trip member (can be a logged-in user or a guest)
export type TripMember = {
  id: string
  tripId: string
  userId: string | null  // null for guests
  name: string
  createdAt: string
}

// Payment record - who paid for an item
export type ExpensePayment = {
  id: string
  itemId: string
  paidBy: string  // trip_members.id
  paidByName?: string  // populated from trip_members
  amount: number  // in JPY
  createdAt: string
}

// Split record - how an expense is divided among members
export type ExpenseSplit = {
  id: string
  itemId: string
  memberId: string  // trip_members.id
  memberName?: string  // populated from trip_members
  shareType: ShareType
  shareValue: number | null  // percentage (0-100) or fixed amount
}

// Item with expense info
export type ItemWithExpense = Item & {
  payments?: ExpensePayment[]
  splits?: ExpenseSplit[]
}

// Settlement - who owes whom how much
export type Settlement = {
  from: string  // member id
  fromName: string
  to: string  // member id
  toName: string
  amount: number  // in JPY
}

// Member balance - how much each member paid vs owes
export type MemberBalance = {
  memberId: string
  memberName: string
  totalPaid: number
  totalOwed: number
  balance: number  // positive = is owed money, negative = owes money
}

// Settlement summary for a trip
export type SettlementSummary = {
  members: TripMember[]
  balances: MemberBalance[]
  settlements: Settlement[]
  totalExpenses: number
}
