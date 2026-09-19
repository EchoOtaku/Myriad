import type { DynamicContent } from '../../../src/components/ControlPanel/islandContentTypes'
import type { NotificationStreamEvent } from '../../../src/services/notificationApi'
import { StrictMode, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useControlPanelNotifications } from '../../../src/components/ControlPanel/useControlPanelNotifications'
import { useIslandCarousel } from '../../../src/components/ControlPanel/useIslandCarousel'
import { useIslandTextMotion } from '../../../src/components/ControlPanel/useIslandTextMotion'
import { useTappIslandContents } from '../../../src/components/ControlPanel/useTappIslandContents'
import { dynamicContentProvider } from '../../../src/services/DynamicContentProvider'
import notificationApi from '../../../src/services/notificationApi'
import notificationPreferencesApi, { DEFAULT_NOTIFICATION_CATALOG, DEFAULT_NOTIFICATION_PREFERENCES } from '../../../src/services/notificationPreferencesApi'
import '../../../src/components/GlobalControlPanel.css'

let stream: ((event: NotificationStreamEvent) => void) | null = null
notificationApi.list = async () => ({ notifications: [], unread_count: 0, total: 0 })
notificationApi.subscribe = callback => {
  stream = callback
  return () => { if (stream === callback) stream = null }
}
notificationPreferencesApi.get = async () => ({
  success: true,
  preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, delivery: { island: true, toast: false, browser: false } },
  catalog: DEFAULT_NOTIFICATION_CATALOG,
})

function Probe() {
  const tappContents = useTappIslandContents()
  const [paused, setPaused] = useState(false)
  const [userId, setUserId] = useState(1)
  const [count, setCount] = useState(3)
  const carousel = useIslandCarousel(count, paused, 1)
  const [text, setText] = useState('A long lyric '.repeat(20))
  const [type, setType] = useState<'music' | 'weather'>('music')
  const { textRef, needsScroll } = useIslandTextMotion({ text, type, lyricDuration: 5 }, !paused)
  const [notification, setNotification] = useState<DynamicContent | null>(null)
  const onIslandNotification = useCallback((content: DynamicContent | null) => setNotification(content), [])
  const { notifCenter } = useControlPanelNotifications({ enabled: true, userId, panelTab: 'control', onIslandNotification })
  return <>
    <button onClick={() => setUserId(2)}>Switch account</button>
    <output data-tapp-contents>{tappContents.map(content => content.text).join('|')}</output>
    <output data-user>{userId}</output>
    <button onClick={() => setPaused(value => !value)}>Toggle pause</button>
    <button onClick={() => setCount(1)}>Shrink</button>
    <button onClick={() => { setType('music'); setText('B long lyric '.repeat(20)) }}>Next lyric</button>
    <button onClick={() => { setType('weather'); setText('Fine') }}>Short text</button>
    <output data-index>{carousel.currentContentIndex}</output>
    <output data-transition>{String(carousel.isTransitioning)}</output>
    <output data-notification>{notification?.text ?? 'none'}</output>
    <output data-notification-count>{notifCenter.items.length}</output>
    <span data-text ref={textRef} className={`dynamic-text-main ${needsScroll ? 'scrolling' : ''}`} style={{ display: 'block', width: 120, fontSize: 14, lineHeight: '17px' }}>{text}</span>
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Probe /></StrictMode>)
Object.assign(window, { controlPanelContentFixture: {
  provider: dynamicContentProvider,
  unmount: () => root.unmount(),
  notify: (title: string, userId = 1) => stream?.({ event: 'new_notification', notification: {
    id: title, notification_type: 'system_info', priority: 'normal', title, body: 'Fixture body', user_id: userId, created_at: new Date().toISOString(), read: false,
  } }),
  connected: () => stream !== null,
} })
