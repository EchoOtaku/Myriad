import { useCallback, useEffect, useRef } from 'react'
import { isPageVisible, onVisibility } from './core'

interface UseVisibilityIntervalOptions {

  delay: number
  enabled?: boolean

  immediate?: boolean
}

export function useVisibilityInterval(
  callback: () => void,
  options: UseVisibilityIntervalOptions,
) {
  const { delay, enabled = true, immediate = false } = options
  const savedCallback = useRef(callback)
  const timeoutIdRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  const clearTimer = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current)
      timeoutIdRef.current = null
    }
  }, [])

  const scheduleNext = useCallback(() => {
    if (cancelledRef.current || !isPageVisible()) return

    timeoutIdRef.current = window.setTimeout(() => {
      if (cancelledRef.current || !isPageVisible()) return
      savedCallback.current()
      scheduleNext()
    }, delay)
  }, [delay])

  useEffect(() => {
    if (!enabled) return

    cancelledRef.current = false

    if (immediate && isPageVisible()) {
      savedCallback.current()
    }

    scheduleNext()

    const unsubscribe = onVisibility((isVisible) => {
      if (isVisible) {
        if (timeoutIdRef.current === null && !cancelledRef.current) {
          scheduleNext()
        }
      } else {
        clearTimer()
      }
    })

    return () => {
      cancelledRef.current = true
      clearTimer()
      unsubscribe()
    }
  }, [enabled, delay, immediate, scheduleNext, clearTimer])
}
