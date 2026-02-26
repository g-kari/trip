import { useState, useCallback } from 'react'

// Notification permission states
export type NotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported'

// Reminder settings for a trip
export type TripReminderSettings = {
  tripId: string
  enabled: boolean
  tripStartReminder: TripStartReminderOption
  itemReminder: ItemReminderOption
  createdAt: string
  updatedAt: string
}

// Options for trip start reminders
export type TripStartReminderOption = 'none' | '1day' | '3days' | '1week'

// Options for item reminders
export type ItemReminderOption = 'none' | '15min' | '30min' | '1hour' | '2hours'

// Reminder option labels (Japanese)
export const TRIP_START_REMINDER_OPTIONS: { value: TripStartReminderOption; label: string }[] = [
  { value: 'none', label: '通知しない' },
  { value: '1day', label: '1日前' },
  { value: '3days', label: '3日前' },
  { value: '1week', label: '1週間前' },
]

export const ITEM_REMINDER_OPTIONS: { value: ItemReminderOption; label: string }[] = [
  { value: 'none', label: '通知しない' },
  { value: '15min', label: '15分前' },
  { value: '30min', label: '30分前' },
  { value: '1hour', label: '1時間前' },
  { value: '2hours', label: '2時間前' },
]

// Convert reminder option to milliseconds
function tripStartReminderToMs(option: TripStartReminderOption): number {
  switch (option) {
    case '1day': return 24 * 60 * 60 * 1000
    case '3days': return 3 * 24 * 60 * 60 * 1000
    case '1week': return 7 * 24 * 60 * 60 * 1000
    default: return 0
  }
}

function itemReminderToMs(option: ItemReminderOption): number {
  switch (option) {
    case '15min': return 15 * 60 * 1000
    case '30min': return 30 * 60 * 1000
    case '1hour': return 60 * 60 * 1000
    case '2hours': return 2 * 60 * 60 * 1000
    default: return 0
  }
}

// LocalStorage key for reminder settings
const REMINDER_STORAGE_KEY = 'trip-reminders'

// Get all reminder settings from localStorage
function getAllReminderSettings(): Record<string, TripReminderSettings> {
  try {
    const stored = localStorage.getItem(REMINDER_STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

// Save all reminder settings to localStorage
function saveAllReminderSettings(settings: Record<string, TripReminderSettings>): void {
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save reminder settings:', err)
  }
}

// Check notification support (runs once at module load time)
function getInitialNotificationState(): { supported: boolean; permission: NotificationPermission } {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return {
      supported: true,
      permission: Notification.permission as NotificationPermission,
    }
  }
  return {
    supported: false,
    permission: 'unsupported',
  }
}

// Custom hook for notification management
export function useNotifications() {
  const initialState = getInitialNotificationState()
  const [permission, setPermission] = useState<NotificationPermission>(initialState.permission)
  const isSupported = initialState.supported

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false
    }

    try {
      const result = await Notification.requestPermission()
      setPermission(result as NotificationPermission)
      return result === 'granted'
    } catch (err) {
      console.error('Failed to request notification permission:', err)
      return false
    }
  }, [isSupported])

  // Show a notification
  const showNotification = useCallback((title: string, options?: NotificationOptions): Notification | null => {
    if (!isSupported || permission !== 'granted') {
      return null
    }

    try {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        lang: 'ja',
        ...options,
      })

      // Auto-close after 10 seconds
      setTimeout(() => {
        notification.close()
      }, 10000)

      return notification
    } catch (err) {
      console.error('Failed to show notification:', err)
      return null
    }
  }, [isSupported, permission])

  // Get reminder settings for a specific trip
  const getReminderSettings = useCallback((tripId: string): TripReminderSettings | null => {
    const allSettings = getAllReminderSettings()
    return allSettings[tripId] || null
  }, [])

  // Save reminder settings for a specific trip
  const saveReminderSettings = useCallback((settings: TripReminderSettings): void => {
    const allSettings = getAllReminderSettings()
    allSettings[settings.tripId] = {
      ...settings,
      updatedAt: new Date().toISOString(),
    }
    saveAllReminderSettings(allSettings)
  }, [])

  // Delete reminder settings for a specific trip
  const deleteReminderSettings = useCallback((tripId: string): void => {
    const allSettings = getAllReminderSettings()
    delete allSettings[tripId]
    saveAllReminderSettings(allSettings)
  }, [])

  // Create default reminder settings for a trip
  const createDefaultSettings = useCallback((tripId: string): TripReminderSettings => {
    const now = new Date().toISOString()
    return {
      tripId,
      enabled: true,
      tripStartReminder: '1day',
      itemReminder: '30min',
      createdAt: now,
      updatedAt: now,
    }
  }, [])

  return {
    permission,
    isSupported,
    requestPermission,
    showNotification,
    getReminderSettings,
    saveReminderSettings,
    deleteReminderSettings,
    createDefaultSettings,
  }
}

// Scheduled notification manager
// This manages timeouts for scheduled notifications
type ScheduledNotification = {
  id: string
  timeoutId: ReturnType<typeof setTimeout>
  scheduledTime: Date
}

const scheduledNotifications: Map<string, ScheduledNotification> = new Map()

// Schedule a notification for a specific time
export function scheduleNotification(
  id: string,
  title: string,
  body: string,
  scheduledTime: Date,
  options?: Omit<NotificationOptions, 'body'>
): boolean {
  // Check if notifications are supported and permitted
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false
  }

  // Cancel any existing notification with the same ID
  cancelScheduledNotification(id)

  const now = new Date()
  const delay = scheduledTime.getTime() - now.getTime()

  // Don't schedule if the time has already passed
  if (delay <= 0) {
    return false
  }

  // Don't schedule if too far in the future (max 7 days)
  const maxDelay = 7 * 24 * 60 * 60 * 1000
  if (delay > maxDelay) {
    return false
  }

  const timeoutId = setTimeout(() => {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        lang: 'ja',
        tag: id, // Prevent duplicate notifications
        ...options,
      })
    } catch (err) {
      console.error('Failed to show scheduled notification:', err)
    }
    scheduledNotifications.delete(id)
  }, delay)

  scheduledNotifications.set(id, {
    id,
    timeoutId,
    scheduledTime,
  })

  return true
}

// Cancel a scheduled notification
export function cancelScheduledNotification(id: string): void {
  const scheduled = scheduledNotifications.get(id)
  if (scheduled) {
    clearTimeout(scheduled.timeoutId)
    scheduledNotifications.delete(id)
  }
}

// Cancel all scheduled notifications for a trip
export function cancelAllTripNotifications(tripId: string): void {
  for (const [id] of scheduledNotifications) {
    if (id.startsWith(`trip-${tripId}-`)) {
      cancelScheduledNotification(id)
    }
  }
}

// Schedule reminders for a trip
export function scheduleTripReminders(
  tripId: string,
  tripTitle: string,
  tripStartDate: string | null,
  items: Array<{ id: string; title: string; timeStart: string | null; dayId: string }>,
  days: Array<{ id: string; date: string }>,
  settings: TripReminderSettings
): number {
  if (!settings.enabled) {
    cancelAllTripNotifications(tripId)
    return 0
  }

  let scheduledCount = 0

  // Schedule trip start reminder
  if (tripStartDate && settings.tripStartReminder !== 'none') {
    const tripStart = new Date(tripStartDate)
    tripStart.setHours(9, 0, 0, 0) // 9:00 AM on the start day

    const reminderMs = tripStartReminderToMs(settings.tripStartReminder)
    const reminderTime = new Date(tripStart.getTime() - reminderMs)

    const label = TRIP_START_REMINDER_OPTIONS.find(o => o.value === settings.tripStartReminder)?.label || ''

    if (scheduleNotification(
      `trip-${tripId}-start`,
      `${tripTitle}`,
      `旅行開始まで${label}です`,
      reminderTime
    )) {
      scheduledCount++
    }
  }

  // Schedule item reminders
  if (settings.itemReminder !== 'none') {
    const reminderMs = itemReminderToMs(settings.itemReminder)
    const label = ITEM_REMINDER_OPTIONS.find(o => o.value === settings.itemReminder)?.label || ''

    for (const item of items) {
      if (!item.timeStart) continue

      // Find the day for this item
      const day = days.find(d => d.id === item.dayId)
      if (!day) continue

      // Parse the time and create full datetime
      const [hours, minutes] = item.timeStart.split(':').map(Number)
      if (isNaN(hours) || isNaN(minutes)) continue

      const itemTime = new Date(day.date)
      itemTime.setHours(hours, minutes, 0, 0)

      const reminderTime = new Date(itemTime.getTime() - reminderMs)

      if (scheduleNotification(
        `trip-${tripId}-item-${item.id}`,
        `${item.title}`,
        `${label}に始まります`,
        reminderTime
      )) {
        scheduledCount++
      }
    }
  }

  return scheduledCount
}

// Get the number of scheduled notifications for a trip
export function getScheduledNotificationCount(tripId: string): number {
  let count = 0
  for (const [id] of scheduledNotifications) {
    if (id.startsWith(`trip-${tripId}-`)) {
      count++
    }
  }
  return count
}
