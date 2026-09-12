import { useState } from 'react'
import notificationPreferencesApi, {
  areNotificationPreferencesEqual,
  cloneNotificationPreferences,
  DEFAULT_NOTIFICATION_CATALOG,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '../../../../services/notificationPreferencesApi'
import { useConfigDomain } from '../useConfigDomain'

export function useNotificationDomain(userId?: number) {
  const [catalog, setCatalog] = useState(DEFAULT_NOTIFICATION_CATALOG)
  const domain = useConfigDomain({
    id: 'notifications',
    sections: ['notifications'],
    initial: DEFAULT_NOTIFICATION_PREFERENCES,
    equal: areNotificationPreferencesEqual,
    load: async () => {
      const response = await notificationPreferencesApi.get()
      setCatalog(response.catalog)
      return cloneNotificationPreferences(response.preferences)
    },
    persist: async (draft) =>
      cloneNotificationPreferences(
        await notificationPreferencesApi.update(draft, userId),
      ),
    reset: (_saved, scope) =>
      scope === 'notifications' || scope === 'all'
        ? cloneNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES)
        : undefined,
  })
  return { ...domain, catalog }
}
