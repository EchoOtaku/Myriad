import apiService from './api'

export const NOTIFICATION_SOURCE_KEYS = [
  'agent',
  'heartbeat',
  'mcp',
  'brew',
  'tapp',
  'updater',
  'federation',
  'system',
] as const

export type NotificationSourceKey = (typeof NOTIFICATION_SOURCE_KEYS)[number]

export const NOTIFICATION_EVENT_KEYS = [
  'agent.task_progress',
  'agent.task_completed',
  'agent.task_failed',
  'agent.task_cancelled',
  'agent.clarification',
  'heartbeat.succeeded',
  'heartbeat.failed',
  'mcp.connected',
  'mcp.disconnected',
  'brew.new_items',
  'brew.source_error',
  'tapp.message',
  'tapp.warning',
  'tapp.error',
  'updater.submitted',
  'updater.running',
  'updater.succeeded',
  'updater.failed',
  'updater.needs_manual',
  'updater.unknown',
  'federation.channel_message',
  'federation.room_message',
  'federation.new_follower',
  'federation.follow_accepted',
  'federation.channel_invite',
  'federation.room_invite',
  'federation.channel_accepted',
  'system.info',
] as const

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number]

export interface NotificationDeliveryPreferences {
  island: boolean
  high_priority_toast: boolean
  browser: boolean
}

export interface NotificationPreferences {
  enabled: boolean
  sources: Record<NotificationSourceKey, boolean>
  events: Record<NotificationEventKey, boolean>
  delivery: NotificationDeliveryPreferences
}

export interface NotificationEventDefinition {
  key: NotificationEventKey
  source: NotificationSourceKey
}

export interface NotificationPreferencesResponse {
  success: boolean
  preferences: NotificationPreferences
  catalog: {
    sources: NotificationSourceKey[]
    events: NotificationEventDefinition[]
  }
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  sources: Object.fromEntries(
    NOTIFICATION_SOURCE_KEYS.map((key) => [key, true]),
  ) as Record<NotificationSourceKey, boolean>,
  events: Object.fromEntries(
    NOTIFICATION_EVENT_KEYS.map((key) => [key, true]),
  ) as Record<NotificationEventKey, boolean>,
  delivery: {
    island: true,
    high_priority_toast: true,
    browser: true,
  },
}

export const DEFAULT_NOTIFICATION_CATALOG = {
  sources: [...NOTIFICATION_SOURCE_KEYS],
  events: NOTIFICATION_EVENT_KEYS.map((key) => ({
    key,
    source: key.split('.')[0] as NotificationSourceKey,
  })),
}

export const NOTIFICATION_PREFERENCES_UPDATED_EVENT =
  'notification-preferences-updated'

const BASE = '/agent/notifications/preferences'

export const notificationPreferencesApi = {
  get(): Promise<NotificationPreferencesResponse> {
    return apiService.get(BASE)
  },

  async update(
    preferences: NotificationPreferences,
    userId?: number,
  ): Promise<NotificationPreferences> {
    const response = await apiService.put<{
      success: boolean
      preferences: NotificationPreferences
    }>(BASE, preferences)
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_PREFERENCES_UPDATED_EVENT, {
        detail: { preferences: response.preferences, userId },
      }),
    )
    return response.preferences
  },
}

export default notificationPreferencesApi
