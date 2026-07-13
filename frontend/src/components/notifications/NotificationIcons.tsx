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
