/** Notes and saved stories keep the full rail extent, but only mount nearby columns. */
import type { FocusEvent, RefObject } from 'react'
import type { PhantasiRailApi } from './usePhantasiRailPan'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { usePhantasiRailPan } from './usePhantasiRailPan'

const PAD_COLUMNS = 4
const BOOT_COLUMNS = 12

export function storyWindow(
  count: number,
  scroll: number,
  viewW: number,
  colW: number,
) {
  const cols = Math.ceil(count / 2)
  if (colW <= 1) return { from: 0, to: Math.min(count, BOOT_COLUMNS * 2) }
  const lead = Math.min(
    Math.max(0, cols - 1),
    Math.max(0, Math.floor(scroll / colW)),
  )
  return {
    from: Math.max(0, lead - PAD_COLUMNS) * 2,
    to: Math.min(
      count,
      (lead + Math.max(1, Math.ceil(viewW / colW)) + PAD_COLUMNS) * 2,
    ),
  }
}

export function useStoryWindow(
  count: number,
  resetKey: unknown,
  viewportRef: RefObject<HTMLDivElement | null>,
  trackRef: RefObject<HTMLDivElement | null>,
  onGrab: () => void,
  originKey: unknown,
) {
  const previousOrigin = useRef(originKey)
  const apiRef = useRef<PhantasiRailApi | null>(null)
  const [window, setWindow] = useState(() => storyWindow(count, 0, 0, 0))
  const [focusColumn, setFocusColumn] = useState<number | null>(null)
  const update = useCallback(
    (state: { scroll: number; viewW: number; colW: number }) => {
      const next = storyWindow(count, state.scroll, state.viewW, state.colW)
      setWindow((prev) =>
        prev.from === next.from && prev.to === next.to ? prev : next,
      )
    },
    [count],
  )
  usePhantasiRailPan(
    viewportRef,
    trackRef,
    count > 0,
    originKey,
    '.phantasi-story',
    undefined,
    apiRef,
    true,
    update,
    onGrab,
  )
  useLayoutEffect(() => {
    const api = apiRef.current
    if (!api) return
    if (previousOrigin.current !== originKey) {
      previousOrigin.current = originKey
      setFocusColumn(null)
      api.seek(0)
    }
    api.refresh()
    const { scroll, max, colW } = api.range()
    if (scroll > max) {
      api.seek(max)
      api.refresh()
    }
    update({
      scroll: Math.min(scroll, max),
      colW,
      viewW: viewportRef.current?.clientWidth ?? 0,
    })
  }, [count, resetKey, originKey, window.from, window.to, update, viewportRef])

  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-rail-col]',
      )
      const col = Number(card?.dataset.railCol)
      if (!col || !apiRef.current) return
      setFocusColumn(col)
      const api = apiRef.current
      const { scroll, colW } = api.range()
      const viewW = viewportRef.current?.clientWidth ?? 0
      const left = (col - 1) * colW
      // Tab into overscan advances the rail before its next card can be unmounted.
      if (left < scroll || left + colW > scroll + viewW) {
        api.alignColumn(col, true)
        update({ scroll: api.range().scroll, colW, viewW })
      }
    },
    [update, viewportRef],
  )
  const onBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setFocusColumn(null)
  }, [])

  const from = Math.min(window.from, Math.max(0, Math.ceil(count / 2) - 1) * 2)
  const to = Math.min(count, Math.max(from + 2, window.to))
  const indices = Array.from(
    { length: Math.max(0, to - from) },
    (_, i) => from + i,
  )
  // Keep at most one focused column mounted during mouse/touch scrolling.
  if (focusColumn != null) {
    for (const index of [(focusColumn - 1) * 2, (focusColumn - 1) * 2 + 1]) {
      if (index < count && (index < from || index >= to)) indices.push(index)
    }
    indices.sort((a, b) => a - b)
  }
  return { indices, onFocusCapture, onBlurCapture }
}
