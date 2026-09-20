import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { preloadCriticalRoutes } from '../utils/codeSplitting'
import { isDocumentReady, subscribeDocumentReady } from '../utils/pageLoader'

const TappBackgroundRunner = lazy(() => import('../tapp/components/TappBackgroundRunner'))

function useDocumentReady() {
  return useSyncExternalStore(subscribeDocumentReady, isDocumentReady, () => false)
}

/** Own the one-time background startup without re-rendering the application shell. */
export function BackgroundTappHost() {
  const documentReady = useDocumentReady()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!documentReady) return
    let idleId: number | null = null
    const start = () => setReady(true)
    const timerId = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = requestIdleCallback(start, { timeout: 4000 })
      } else {
        start()
      }
    }, 3000)
    return () => {
      window.clearTimeout(timerId)
      if (idleId !== null && 'cancelIdleCallback' in window) cancelIdleCallback(idleId)
    }
  }, [documentReady])

  return ready ? <Suspense fallback={null}><TappBackgroundRunner /></Suspense> : null
}

/** Optional warming owns both the delay and the cancel handle for its queued imports. */
export function RouteWarmup() {
  const documentReady = useDocumentReady()
  useEffect(() => {
    if (!documentReady) return
    let cancelPrefetch: (() => void) | undefined
    const timer = setTimeout(() => {
      cancelPrefetch = preloadCriticalRoutes()
    }, 8000)
    return () => {
      clearTimeout(timer)
      cancelPrefetch?.()
    }
  }, [documentReady])
  return null
}
