import type { EventCallback } from '../utils/sharedEventManager'
import { useEffect, useRef, useState } from 'react'
import { sharedEventManager } from '../utils/sharedEventManager'

export function useSharedEventListener(
  eventType: string,
  callback: EventCallback,
  { priority = 0, throttle = true, enabled = true }: {
    priority?: number
    throttle?: boolean
    enabled?: boolean
  } = {},
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    if (!enabled) return
    return sharedEventManager.add(eventType, event => callbackRef.current(event), {
      priority,
      throttle,
    })
  }, [eventType, priority, throttle, enabled])
}

export function useSharedResize(
  callback: () => void,
  { priority = 0, enabled = true, debounce = 0 }: {
    priority?: number
    enabled?: boolean
    debounce?: number
  } = {},
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const remove = sharedEventManager.add('resize', () => {
      if (debounce <= 0) {
        callbackRef.current()
        return
      }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        callbackRef.current()
      }, debounce)
    }, { priority, throttle: debounce <= 0 })
    return () => {
      remove()
      if (timer !== null) clearTimeout(timer)
    }
  }, [priority, enabled, debounce])
}

export function useSharedScroll(
  callback: EventCallback,
  options: { priority?: number, enabled?: boolean } = {},
): void {
  useSharedEventListener('scroll', callback, { ...options, throttle: true })
}

function readWindowSize() {
  return {
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }
}

/** The resize subscription owns debounce cancellation and disabled lifetimes. */
export function useDebouncedWindowSize(delay = 150, enabled = true) {
  const [size, setSize] = useState(readWindowSize)
  useSharedResize(() => setSize(readWindowSize()), { enabled, debounce: delay })
  useEffect(() => {
    if (enabled) setSize(readWindowSize())
  }, [enabled])
  return size
}
