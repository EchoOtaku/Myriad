import type { AppNotification } from '../../services/notificationApi'
import type { NotificationSourceKey } from '../../services/notificationPreferencesApi'

const NOTIFICATION_SOURCE_ICON_ASSETS = {
  agent: '/icons/notifications/arael.png',
  heartbeat: '/icons/notifications/heartbeat.png',
  mcp: '/icons/notifications/mcp.png',
  brew: '/icons/notifications/brew.png',
  tapp: '/icons/notifications/tapp.png',
  updater: '/icons/notifications/updater.png',
  federation: '/icons/notifications/aro.png',
  system: '/icons/notifications/system.png',
} satisfies Record<NotificationSourceKey, string>

export function notificationSourceIconAsset(source: NotificationSourceKey) {
  return NOTIFICATION_SOURCE_ICON_ASSETS[source]
}

export function notificationSourceFor(
  notification: AppNotification,
): NotificationSourceKey {
  const eventKey = notification.metadata?.event_key
  if (typeof eventKey === 'string') {
    const source = eventKey.split('.')[0]
    if (
      source === 'agent' ||
      source === 'heartbeat' ||
      source === 'mcp' ||
      source === 'brew' ||
      source === 'tapp' ||
      source === 'updater' ||
      source === 'federation' ||
      source === 'system'
    ) {
      return source
    }
  }
  if (notification.notification_type.startsWith('task_')) return 'agent'
  if (notification.notification_type === 'agent_clarification') return 'agent'
  if (notification.notification_type === 'heartbeat_result') return 'heartbeat'
  if (notification.notification_type === 'mcp_server_status') return 'mcp'
  if (notification.notification_type.startsWith('brew_')) return 'brew'
  if (notification.notification_type === 'tapp_notification') return 'tapp'
  if (notification.notification_type === 'updater_status') return 'updater'
  if (notification.notification_type.startsWith('federation_'))
    return 'federation'
  return 'system'
}

function RasterNotificationIcon({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={className}
      draggable={false}
    />
  )
}

export function NotificationSourceIcon({
  source,
  className = 'h-4 w-4',
}: {
  source: NotificationSourceKey
  className?: string
}) {
  return (
    <RasterNotificationIcon
      src={notificationSourceIconAsset(source)}
      className={className}
    />
  )
}
