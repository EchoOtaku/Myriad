import type { PublishEventV2Request, TappEventV2, TappInstance } from '../types'
import * as TappApiService from '../services/TappApiService'
import type { TappBridge } from './TappBridge'
import { getDefaultLocale } from '../../i18n'
import { subscribeToTheme } from '../../utils/themeSubscriber'

const RECONNECT_DELAY_MS = 500

/**
 * Connect one Page/Widget/headless runtime to the online event broker.
 * Runtime Grants remain host-only; the sandbox receives validated envelopes.
 */
export function registerEventHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance,
): () => void {
  let stopped = false
  let streamController: AbortController | null = null
  const cleanupSystemProducers: Array<() => void> = []
  const subscriptions = new Set(tappInstance.manifest.events?.subscribe ?? [])
  const hasServerSubscriptions = [...subscriptions].some(
    (topic) => !topic.startsWith('system.'),
  )

  // system.* topics are produced by the trusted host, never by sandbox code.
  // They are browser-local facts, so delivering them directly also avoids
  // pretending that theme/network/visibility state is global server state.
  let hostRuntimeId = 'host'
  void bridge
    .getRuntimeId()
    .then((runtimeId) => {
      hostRuntimeId = runtimeId
    })
    .catch(() => undefined)
  const emitSystem = (topic: string, payload: unknown) => {
    if (!subscriptions.has(topic) || stopped) return
    bridge.emit('tappEventV2', {
      version: 2,
      eventId: `sys_${crypto.randomUUID().replaceAll('-', '')}`,
      topic,
      scope: 'instance',
      source: { tappId: 'system.host', runtimeId: hostRuntimeId },
      payload,
      occurredAt: new Date().toISOString(),
    } satisfies TappEventV2)
  }

  if (subscriptions.has('system.theme.changed')) {
    cleanupSystemProducers.push(
      subscribeToTheme((isDark) =>
        emitSystem('system.theme.changed', {
          theme: isDark ? 'dark' : 'light',
        }),
      ),
    )
  }
  if (subscriptions.has('system.network.changed')) {
    const onNetwork = () =>
      emitSystem('system.network.changed', { online: navigator.onLine })
    window.addEventListener('online', onNetwork)
    window.addEventListener('offline', onNetwork)
    onNetwork()
    cleanupSystemProducers.push(() => {
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
    })
  }
  if (subscriptions.has('system.locale.changed')) {
    const onLocale = () =>
      emitSystem('system.locale.changed', { locale: getDefaultLocale() })
    window.addEventListener('languagechange', onLocale)
    window.addEventListener('storage', onLocale)
    onLocale()
    cleanupSystemProducers.push(() => {
      window.removeEventListener('languagechange', onLocale)
      window.removeEventListener('storage', onLocale)
    })
  }
  if (subscriptions.has('system.visibility.changed')) {
    const onVisibility = () =>
      emitSystem('system.visibility.changed', {
        visibility: document.visibilityState,
      })
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    cleanupSystemProducers.push(() =>
      document.removeEventListener('visibilitychange', onVisibility),
    )
  }
  if (subscriptions.has('system.navigation.changed')) {
    const onNavigation = () =>
      emitSystem('system.navigation.changed', {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      })
    window.addEventListener('popstate', onNavigation)
    window.addEventListener('hashchange', onNavigation)
    document.addEventListener('astro:page-load', onNavigation)
    onNavigation()
    cleanupSystemProducers.push(() => {
      window.removeEventListener('popstate', onNavigation)
      window.removeEventListener('hashchange', onNavigation)
      document.removeEventListener('astro:page-load', onNavigation)
    })
  }

  bridge.registerHandler('event.v2.publish', async (message) => {
    const [request] = (message.payload as { args: unknown[] }).args || []
    if (!request) return { success: false, error: 'Event request required' }
    try {
      const result = await TappApiService.publishEventV2(
        request as PublishEventV2Request,
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Event publish failed',
      }
    }
  })

  // One-version migration adapter. No free-form target or implicit broadcast.
  bridge.registerHandler('event.publish', async (message) => {
    const [topic, payload, target] =
      (message.payload as { args: unknown[] }).args || []
    if (target !== 'self') {
      return {
        success: false,
        error:
          'Legacy event.publish only supports target="self"; use event.v2.publish',
      }
    }
    try {
      const result = await TappApiService.publishEventV2(
        {
          topic: String(topic || ''),
          scope: 'instance',
          payload,
        },
        await bridge.getRuntimeGrant(),
      )
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Event publish failed',
      }
    }
  })

  const removedSubscriptionError = {
    success: false,
    error:
      'Persistent event subscriptions were removed; declare events.subscribe in manifest',
  }
  bridge.registerHandler(
    'event.subscribe',
    async () => removedSubscriptionError,
  )
  bridge.registerHandler(
    'event.unsubscribe',
    async () => removedSubscriptionError,
  )

  if (hasServerSubscriptions) {
    void (async () => {
      while (!stopped) {
        streamController = new AbortController()
        try {
          await TappApiService.streamEventsV2(
            await bridge.getRuntimeGrant(),
            (event, data) => {
              if (event === 'event' && data && typeof data === 'object') {
                bridge.emit('tappEventV2', data as TappEventV2)
              }
            },
            streamController.signal,
          )
        } catch (error) {
          if (!stopped && !streamController.signal.aborted) {
            console.warn('[TappEventBroker] Runtime stream disconnected', error)
          }
        } finally {
          streamController = null
        }
        if (!stopped) {
          await new Promise((resolve) =>
            setTimeout(resolve, RECONNECT_DELAY_MS),
          )
        }
      }
    })()
  }

  return () => {
    stopped = true
    cleanupSystemProducers.forEach((cleanup) => cleanup())
    streamController?.abort()
    streamController = null
  }
}
