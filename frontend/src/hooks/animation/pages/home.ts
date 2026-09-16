import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getPageIntervalManager,
  getPageResizeManager,
  isPageVisible,
  onVisibility,
  registerPageCleanup,
} from '../core'
import { Feature, hasFeature } from '../pageFeatures'

const PAGE_ID = 'home'

/** startPage('home') 由 useRouteScheduler 统一调用。 */
export function useHomeScheduler(): void {
  useEffect(() => {
    return () => cleanupHome()
  }, [])
}

function useHomeVisibility(): boolean {
  const [visible, setVisible] = useState(() => isPageVisible())

  useEffect(() => {
    if (!hasFeature(PAGE_ID, Feature.Visibility)) {
      console.warn('[Home] Visibility feature not enabled')
      return
    }
    return onVisibility(setVisible)
  }, [])

  return visible
}

function getIntervalManager() {
  return getPageIntervalManager(PAGE_ID)
}

export function useHomeVisibilityInterval(
  callback: () => void,
  delay: number,
  enabled = true,
): void {
  const savedCallback = useRef(callback)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const visible = useHomeVisibility()

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return

    if (visible) {
      intervalRef.current = setInterval(() => {
        savedCallback.current()
      }, delay)
      getIntervalManager().add(intervalRef.current)
    }

    return () => {
      if (intervalRef.current !== null) {
        getIntervalManager().remove(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [delay, visible, enabled])
}

function getResizeManager() {
  return getPageResizeManager(PAGE_ID)
}

export function useHomeResizeObserver(): {
  observeHomeResize: (
    el: Element,
    callback: (entry: ResizeObserverEntry) => void,
  ) => void
  unobserveHomeResize: (el: Element) => void
} {
  const observeHomeResize = useCallback(
    (el: Element, callback: (entry: ResizeObserverEntry) => void) => {
      if (!hasFeature(PAGE_ID, Feature.Resize)) {
        return
      }
      const manager = getResizeManager()
      manager.observe(el, callback)

      const rect = el.getBoundingClientRect()
      callback({ contentRect: rect } as ResizeObserverEntry)
    },
    [],
  )

  const unobserveHomeResize = useCallback((el: Element) => {
    getResizeManager().unobserve(el)
  }, [])

  return { observeHomeResize, unobserveHomeResize }
}

export function cleanupHome(): void {
  getPageIntervalManager(PAGE_ID).cleanup()
  getPageResizeManager(PAGE_ID).cleanup()
}

registerPageCleanup(PAGE_ID, cleanupHome)
