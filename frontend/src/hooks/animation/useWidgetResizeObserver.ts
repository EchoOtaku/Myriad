import { useCallback, useEffect, useRef } from 'react'
import { createFrameResizeObserver } from './frameResizeObserver'

// Widgets also live in the global panel. Their observers belong to mounted
// components, not to the home route. Native delivery avoids a frame of lag.
const resize = createFrameResizeObserver({
  isVisible: () => true,
  delivery: 'native',
})

export function useWidgetResizeObserver() {
  const subscriptions = useRef(new Map<Element, () => void>())

  const unobserveWidgetResize = useCallback((element: Element) => {
    subscriptions.current.get(element)?.()
    subscriptions.current.delete(element)
  }, [])

  const observeWidgetResize = useCallback((
    element: Element,
    callback: (entry: ResizeObserverEntry) => void,
  ) => {
    subscriptions.current.get(element)?.()
    subscriptions.current.set(element, resize.observe(element, callback))
  }, [])

  useEffect(() => {
    const owned = subscriptions.current
    return () => {
      for (const unsubscribe of owned.values()) unsubscribe()
      owned.clear()
    }
  }, [])

  return { observeWidgetResize, unobserveWidgetResize }
}
