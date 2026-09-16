import { useEffect, useRef } from 'react'
import { now, scheduleIdle } from './core'

export function useIdleEffect(
  callback: () => void,
  deps: React.DependencyList,
  options?: { priority?: 'low' | 'normal' | 'high' },
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const id = `idle-${now()}-${Math.random().toString(36).slice(2, 9)}`
    const cancel = scheduleIdle(
      id,
      () => callbackRef.current(),
      options?.priority,
    )
    return cancel
  }, deps)
}
