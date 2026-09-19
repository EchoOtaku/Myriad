type ResizeCallback = (entry: ResizeObserverEntry) => void

/**
 * Shared frame delivery mechanics; each owner keeps its own box/lifecycle.
 * Native entries are never fabricated from transformed bounding rectangles.
 * Within a frame only the latest size wins, without quantizing small changes.
 */
export function createFrameResizeObserver(options: {
  isVisible: () => boolean
  box?: ResizeObserverBoxOptions
  delivery?: 'native' | 'frame'
}) {
  let observer: ResizeObserver | null = null
  let frame: number | null = null
  let pending = new Map<Element, ResizeObserverEntry>()
  const callbacks = new WeakMap<Element, ResizeCallback>()
  const sizes = new WeakMap<Element, { width: number; height: number }>()

  function cancelPending() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    pending.clear()
  }

  function flush() {
    frame = null
    const batch = pending
    pending = new Map()
    for (const [element, entry] of batch) {
      const callback = callbacks.get(element)
      if (!callback) continue
      try {
        callback(entry)
      } catch (error) {
        console.error('ResizeObserver callback error:', error)
      }
    }
  }

  function unobserve(element: Element) {
    observer?.unobserve(element)
    callbacks.delete(element)
    sizes.delete(element)
    pending.delete(element)
    if (pending.size === 0) cancelPending()
  }

  function observe(element: Element, callback: ResizeCallback): () => void {
    if (!element || typeof ResizeObserver === 'undefined') return () => {}
    if (!observer) {
      observer = new ResizeObserver((entries) => {
        if (!options.isVisible()) return
        for (const entry of entries) {
          if (!callbacks.has(entry.target)) continue
          const { width, height } = entry.contentRect
          const previous = sizes.get(entry.target)
          if (previous?.width === width && previous.height === height) continue
          sizes.set(entry.target, { width, height })
          pending.set(entry.target, entry)
        }
        if (options.delivery === 'native') {
          flush()
          return
        }
        if (frame === null && pending.size > 0)
          frame = requestAnimationFrame(flush)
      })
    }
    callbacks.set(element, callback)
    observer.observe(element, options.box ? { box: options.box } : undefined)
    return () => unobserve(element)
  }

  return {
    observe,
    unobserve,
    cancelPending,
    getCachedSize: (element: Element) => sizes.get(element) ?? null,
  }
}
