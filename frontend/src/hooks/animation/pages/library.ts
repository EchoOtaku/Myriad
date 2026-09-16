import { useCallback, useEffect } from 'react'
import { registerPageCleanup } from '../core'
import { Feature, hasFeature } from '../pageFeatures'

const PAGE_ID = 'library'

/** startPage('library') 由 useRouteScheduler 统一调用。 */
export function useLibraryScheduler(): void {
  useEffect(() => {
    return () => cleanupLibrary()
  }, [])
}

let _libraryIntersectionObserver: IntersectionObserver | null = null
const _libraryIntersectionCallbacks = new Map<
  Element,
  (entry: IntersectionObserverEntry) => void
>()

function getLibraryIntersectionObserver(): IntersectionObserver {
  if (!_libraryIntersectionObserver) {
    _libraryIntersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = _libraryIntersectionCallbacks.get(entry.target)
          if (cb) cb(entry)
        }
      },
      {
        rootMargin: '200px', // 提前 200px 开始加载
        threshold: 0,
      },
    )
  }
  return _libraryIntersectionObserver
}

export function useLibraryIntersectionObserver(): {
  observeLibraryIntersection: (
    el: Element,
    callback: (entry: IntersectionObserverEntry) => void,
  ) => void
  unobserveLibraryIntersection: (el: Element) => void
} {
  const observeLibraryIntersection = useCallback(
    (el: Element, callback: (entry: IntersectionObserverEntry) => void) => {
      if (!hasFeature(PAGE_ID, Feature.Intersection)) {
        callback({ isIntersecting: true } as IntersectionObserverEntry)
        return
      }
      const observer = getLibraryIntersectionObserver()
      _libraryIntersectionCallbacks.set(el, callback)
      observer.observe(el)
    },
    [],
  )

  const unobserveLibraryIntersection = useCallback((el: Element) => {
    _libraryIntersectionCallbacks.delete(el)
    if (_libraryIntersectionObserver) {
      _libraryIntersectionObserver.unobserve(el)
    }
  }, [])

  return { observeLibraryIntersection, unobserveLibraryIntersection }
}

export function cleanupLibrary(): void {
  if (_libraryIntersectionObserver) {
    _libraryIntersectionObserver.disconnect()
    _libraryIntersectionObserver = null
  }
  _libraryIntersectionCallbacks.clear()
}

registerPageCleanup(PAGE_ID, cleanupLibrary)
