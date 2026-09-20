import type { ComponentType } from 'react'
import { lazy } from 'react'
import { yieldToMain } from './yieldToMain'

export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  let pending: Promise<{ default: T }> | undefined
  const preload = () => {
    pending ??= Promise.resolve()
      .then(factory)
      .catch((error) => {
        // Speculative failures must not poison a later navigation attempt.
        pending = undefined
        throw error
      })
    return pending
  }
  return Object.assign(lazy(preload), { preload })
}

function canPrefetch() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  return (
    !connection?.saveData &&
    connection?.effectiveType !== 'slow-2g' &&
    connection?.effectiveType !== '2g'
  )
}

/** Cancel queued work; an import already in flight is shared and cannot be aborted. */
export function preloadRoutes(routes: readonly string[]): () => void {
  if (!canPrefetch()) return () => {}

  let cancelled = false
  const run = async () => {
    for (const route of new Set(routes)) {
      if (cancelled || !canPrefetch()) return
      const component = routeComponents[route as keyof typeof routeComponents]
      if (!component) continue
      try {
        await component.preload()
      } catch {
        // Optional warming must never surface an unhandled rejection.
        // Navigation retains its own error boundary and can retry the import.
      }
      if (!cancelled) await yieldToMain()
    }
  }

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(() => {
      void run()
    })
    return () => {
      cancelled = true
      window.cancelIdleCallback(id)
    }
  }
  const id = setTimeout(() => {
    void run()
  }, 0)
  return () => {
    cancelled = true
    clearTimeout(id)
  }
}

export const routeComponents = {
  home: lazyWithPreload(() => import('../views/Home')),

  library: lazyWithPreload(() => import('../views/Library')),

  config: lazyWithPreload(() => import('../views/Config')),

  setup: lazyWithPreload(() => import('../views/Setup')),

  login: lazyWithPreload(() => import('../views/Login')),

  tapp: lazyWithPreload(() => import('../tapp/pages/TappListPage.tsx')),
  tappStore: lazyWithPreload(() => import('../tapp/pages/TappStorePage.tsx')),
  tappDetail: lazyWithPreload(() => import('../tapp/pages/TappDetailPage.tsx')),
  tappRun: lazyWithPreload(() => import('../tapp/pages/TappRunPage.tsx')),
}

export const CRITICAL_PRELOAD_ROUTES = ['library', 'tapp', 'tappStore'] as const

export function preloadCriticalRoutes(): () => void {
  return preloadRoutes(CRITICAL_PRELOAD_ROUTES)
}

export function preloadTappRoutes(): () => void {
  return preloadRoutes(['tapp', 'tappStore', 'tappDetail', 'tappRun'])
}
