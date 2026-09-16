import type { RefObject } from 'react'
import type { LibraryListIndex } from './libraryListWindow'
import { useLayoutEffect, useMemo, useState } from 'react'
import { queryLibraryListWindow } from './libraryListWindow'

export function useLibraryListWindow<T extends { id: string }>(
  surfaceRef: RefObject<HTMLElement | null>,
  index: LibraryListIndex<T>,
  enabled: boolean,
): T[] {
  const initial = useMemo(() => queryLibraryListWindow(index, 0, 1000), [index])
  const [snapshot, setSnapshot] = useState<{ index: LibraryListIndex<T>; items: T[] } | null>(null)

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!enabled || !surface) return
    let frame = 0
    const update = () => {
      frame = 0
      const items = queryLibraryListWindow(index, -surface.getBoundingClientRect().top, globalThis.window.innerHeight)
      // Do not unmount an actively focused control as the user scrolls.
      const focused = document.activeElement?.closest<HTMLElement>('[data-library-list-id]')
      if (focused && surface.contains(focused)) {
        const id = focused.dataset.libraryListId
        const item = id ? index.itemsById.get(id) : undefined
        if (item && !items.includes(item)) items.push(item)
      }
      setSnapshot(current => current?.index === index
        && current.items.length === items.length
        && current.items.every((item, i) => item === items[i])
        ? current : { index, items })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    // Capture also covers scrollable ancestors; the normal library scrolls the document.
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    globalThis.window.addEventListener('resize', schedule, { passive: true })
    surface.addEventListener('focusout', schedule)
    const resize = new ResizeObserver(schedule)
    resize.observe(surface)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, true)
      globalThis.window.removeEventListener('resize', schedule)
      surface.removeEventListener('focusout', schedule)
      resize.disconnect()
    }
  }, [enabled, index, initial, surfaceRef])

  // Pagination and resize replace the index. Keep surviving rows until the
  // layout effect measures again, otherwise React would discard their focus.
  if (snapshot?.index === index) return snapshot.items
  const retained = snapshot?.items.flatMap(item => {
    const next = index.itemsById.get(item.id)
    return next ? [next] : []
  })
  return retained?.length ? retained : initial
}
