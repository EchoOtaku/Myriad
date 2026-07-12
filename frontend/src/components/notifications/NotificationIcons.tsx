import type { AppNotification } from '../../services/notificationApi'
import type { NotificationSourceKey } from '../../services/notificationPreferencesApi'
import {
  LuActivity,
  LuInfo,
  LuMessageCircle,
  LuRefreshCw,
  LuServer,
  LuSparkles,
  MyriadStoreIcon,
} from '@lib/icons'

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

function BrewIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3"
      />
    </svg>
  )
}

function AroIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </svg>
  )
}

export function NotificationSourceIcon({
  source,
  className = 'h-4 w-4',
}: {
  source: NotificationSourceKey
  className?: string
}) {
  switch (source) {
    case 'agent':
      return <LuSparkles className={className} />
    case 'heartbeat':
      return <LuActivity className={className} />
    case 'mcp':
      return <LuServer className={className} />
    case 'brew':
      return <BrewIcon className={className} />
    case 'tapp':
      return <MyriadStoreIcon className={className} />
    case 'updater':
      return <LuRefreshCw className={className} />
    case 'federation':
      return <AroIcon className={className} />
    case 'system':
      return <LuInfo className={className} />
    default:
      return <LuMessageCircle className={className} />
  }
}
