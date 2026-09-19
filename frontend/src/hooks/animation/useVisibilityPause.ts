import { useEffect, useRef } from 'react'
import { isPageVisible, onVisibility } from './core'

interface UseVisibilityIntervalOptions {
  delay: number
  enabled?: boolean
  immediate?: boolean
}

/** Component-owned polling/rotation; route cleanup must not stop global widgets. */
export function useVisibilityInterval(
  callback: () => void,
  { delay, enabled = true, immediate = false }: UseVisibilityIntervalOptions,
) {
  const savedCallback = useRef(callback)
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const schedule = () => {
      if (cancelled || !isPageVisible() || timer !== null) return
      timer = setTimeout(() => {
        timer = null
        if (cancelled || !isPageVisible()) return
        try {
          savedCallback.current()
        } finally {
          schedule()
        }
      }, delay)
    }
    const unsubscribe = onVisibility((visible) => {
      if (visible) schedule()
      else clearTimer()
    })
    if (immediate && isPageVisible()) savedCallback.current()
    schedule()
    return () => {
      cancelled = true
      clearTimer()
      unsubscribe()
    }
  }, [delay, enabled, immediate])
}
