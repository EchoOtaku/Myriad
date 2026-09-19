import type { SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isPageVisible, onVisibility } from './animation/core'

/** Retain the latest value while hidden, without retaining a queue of update closures. */
export function useVisibleState<T>(initial: T) {
  const [value, setValue] = useState<T>(() => initial)
  const latest = useRef(value)
  const update = useCallback((next: SetStateAction<T>) => {
    latest.current = typeof next === 'function'
      ? (next as (previous: T) => T)(latest.current)
      : next
    if (isPageVisible()) {
      const snapshot = latest.current
      setValue(() => snapshot)
    }
  }, [])
  useEffect(() => {
    const flush = (visible: boolean) => {
      if (!visible) return
      const snapshot = latest.current
      setValue(() => snapshot)
    }
    const unsubscribe = onVisibility(flush)
    flush(isPageVisible())
    return unsubscribe
  }, [])
  return [value, update] as const
}
