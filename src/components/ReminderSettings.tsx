import { useState, useEffect } from 'react'
import {
  useNotifications,
  scheduleTripReminders,
  cancelAllTripNotifications,
  getScheduledNotificationCount,
  TRIP_START_REMINDER_OPTIONS,
  ITEM_REMINDER_OPTIONS,
  type TripReminderSettings,
  type TripStartReminderOption,
  type ItemReminderOption,
} from '../hooks/useNotifications'
import type { Trip } from '../types'

type ReminderSettingsProps = {
  trip: Trip
  onClose: () => void
}

export function ReminderSettings({ trip, onClose }: ReminderSettingsProps) {
  const {
    permission,
    isSupported,
    requestPermission,
    getReminderSettings,
    saveReminderSettings,
    createDefaultSettings,
  } = useNotifications()

  const [settings, setSettings] = useState<TripReminderSettings | null>(null)
  const [scheduledCount, setScheduledCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [requestingPermission, setRequestingPermission] = useState(false)

  // Load settings on mount
  useEffect(() => {
    const existing = getReminderSettings(trip.id)
    if (existing) {
      setSettings(existing)
    } else {
      setSettings(createDefaultSettings(trip.id))
    }
    setScheduledCount(getScheduledNotificationCount(trip.id))
  }, [trip.id, getReminderSettings, createDefaultSettings])

  // Handle permission request
  async function handleRequestPermission() {
    setRequestingPermission(true)
    try {
      await requestPermission()
    } finally {
      setRequestingPermission(false)
    }
  }

  // Handle save
  function handleSave() {
    if (!settings) return

    setSaving(true)
    try {
      saveReminderSettings(settings)

      // Schedule or cancel notifications based on settings
      if (settings.enabled && permission === 'granted') {
        const days = trip.days || []
        const items = trip.items || []
        const count = scheduleTripReminders(
          trip.id,
          trip.title,
          trip.startDate,
          items.map(item => ({
            id: item.id,
            title: item.title,
            timeStart: item.timeStart,
            dayId: item.dayId,
          })),
          days.map(day => ({
            id: day.id,
            date: day.date,
          })),
          settings
        )
        setScheduledCount(count)
      } else {
        cancelAllTripNotifications(trip.id)
        setScheduledCount(0)
      }

      onClose()
    } finally {
      setSaving(false)
    }
  }

  // Handle disable all reminders
  function handleDisableAll() {
    if (!settings) return

    setSettings({ ...settings, enabled: false })
    cancelAllTripNotifications(trip.id)
    setScheduledCount(0)
  }

  // Render permission request UI
  function renderPermissionRequest() {
    if (!isSupported) {
      return (
        <div className="reminder-permission-box reminder-unsupported">
          <p className="reminder-permission-text">
            お使いのブラウザは通知機能に対応していません。
          </p>
          <p className="reminder-permission-hint">
            Chrome、Firefox、Safari などの最新ブラウザをお使いください。
          </p>
        </div>
      )
    }

    if (permission === 'denied') {
      return (
        <div className="reminder-permission-box reminder-denied">
          <p className="reminder-permission-text">
            通知がブロックされています。
          </p>
          <p className="reminder-permission-hint">
            ブラウザの設定から通知を許可してください。
            <br />
            設定 → サイトの設定 → 通知 → このサイトを許可
          </p>
        </div>
      )
    }

    if (permission === 'default') {
      return (
        <div className="reminder-permission-box">
          <p className="reminder-permission-text">
            リマインダーを使用するには通知の許可が必要です。
          </p>
          <button
            className="btn-filled"
            onClick={handleRequestPermission}
            disabled={requestingPermission}
          >
            {requestingPermission ? '許可をリクエスト中...' : '通知を許可する'}
          </button>
        </div>
      )
    }

    return null
  }

  if (!settings) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal reminder-modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="modal-title">リマインダー設定</h2>
          <p className="reminder-loading">読み込み中...</p>
        </div>
      </div>
    )
  }

  const canSchedule = isSupported && permission === 'granted'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal reminder-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">リマインダー設定</h2>

        {renderPermissionRequest()}

        {canSchedule && (
          <div className="reminder-settings-form">
            {/* Enable/Disable toggle */}
            <div className="reminder-toggle-section">
              <label className="reminder-toggle">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                />
                <span className="reminder-toggle-label">リマインダーを有効にする</span>
              </label>
              {scheduledCount > 0 && (
                <span className="reminder-scheduled-count">
                  {scheduledCount}件の通知がスケジュール済み
                </span>
              )}
            </div>

            {settings.enabled && (
              <>
                {/* Trip start reminder */}
                <div className="reminder-option-section">
                  <label className="reminder-option-label">旅行開始前の通知</label>
                  {!trip.startDate && (
                    <p className="reminder-option-hint">
                      開始日が設定されていないため、旅行開始通知は利用できません。
                    </p>
                  )}
                  <select
                    className="input"
                    value={settings.tripStartReminder}
                    onChange={(e) => setSettings({
                      ...settings,
                      tripStartReminder: e.target.value as TripStartReminderOption,
                    })}
                    disabled={!trip.startDate}
                  >
                    {TRIP_START_REMINDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Item reminder */}
                <div className="reminder-option-section">
                  <label className="reminder-option-label">予定開始前の通知</label>
                  <p className="reminder-option-hint">
                    開始時刻が設定されている予定に対して通知します。
                  </p>
                  <select
                    className="input"
                    value={settings.itemReminder}
                    onChange={(e) => setSettings({
                      ...settings,
                      itemReminder: e.target.value as ItemReminderOption,
                    })}
                  >
                    {ITEM_REMINDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Info about limitations */}
                <div className="reminder-info-box">
                  <p className="reminder-info-text">
                    <strong>注意:</strong> 通知はブラウザを開いている間のみ機能します。
                    ブラウザを閉じると、スケジュールされた通知はリセットされます。
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="reminder-actions">
          {settings.enabled && canSchedule && (
            <button
              className="btn-text btn-danger"
              onClick={handleDisableAll}
            >
              すべて無効にする
            </button>
          )}
          <div className="reminder-actions-right">
            <button className="btn-text" onClick={onClose}>
              キャンセル
            </button>
            <button
              className="btn-filled"
              onClick={handleSave}
              disabled={saving || !canSchedule}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Test notification button component (for debugging/testing)
export function TestNotificationButton() {
  const { permission, isSupported, showNotification } = useNotifications()

  function handleTest() {
    if (!isSupported || permission !== 'granted') {
      alert('通知が許可されていません')
      return
    }

    showNotification('テスト通知', {
      body: 'これはテスト通知です。リマインダー機能が正しく動作しています。',
    })
  }

  if (!isSupported || permission !== 'granted') {
    return null
  }

  return (
    <button className="btn-text btn-small" onClick={handleTest}>
      通知テスト
    </button>
  )
}
