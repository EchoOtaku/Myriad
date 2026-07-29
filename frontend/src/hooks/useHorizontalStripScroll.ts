/**
 * Horizontal strip scroll: mouse wheel (vertical → horizontal) + pointer drag.
 *
 * Native overflow-x only handles trackpad / shift+wheel / touch. Desktop mouse
 * users need explicit mapping and drag-to-scroll for a usable carousel.
 */

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  RefObject,
} from 'react'
import { useCallback, useRef, useState } from 'react'

const DRAG_THRESHOLD_PX = 6

export interface HorizontalStripScrollBind {
  ref: RefObject<HTMLDivElement | null>
  onWheel: (e: ReactWheelEvent<HTMLDivElement>) => void
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void
  onClickCapture: (e: ReactMouseEvent<HTMLDivElement>) => void
  /** Append to the strip className (cursor + optional snap suppress). */
  className: string
  /** Merge into the strip style while dragging (disables snap). */
  style: CSSProperties | undefined
  isDragging: boolean
}

export function useHorizontalStripScroll(): HorizontalStripScrollBind {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
    active: false,
  })
  /** After a drag, suppress the synthetic click that would open a card. */
  const suppressClickRef = useRef(false)

  const endDrag = useCallback((el: HTMLDivElement | null, pointerId: number) => {
    const state = dragRef.current
    if (!state.active) return

    if (state.moved) {
      suppressClickRef.current = true
    }

    if (
      el &&
      state.pointerId === pointerId &&
      el.hasPointerCapture?.(pointerId)
    ) {
      try {
        el.releasePointerCapture(pointerId)
      } catch {
        /* already released */
      }
    }

    state.active = false
    state.moved = false
    state.pointerId = -1
    setIsDragging(false)
  }, [])

  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    // Same rule as WidgetGrid: only pure vertical wheel; leave trackpad
    // horizontal (deltaX) to the browser so inertia does not fight us.
    if (e.deltaX !== 0 || e.deltaY === 0) return
    const el = e.currentTarget
    const maxScrollLeft = el.scrollWidth - el.clientWidth
    if (maxScrollLeft <= 0) return
    e.preventDefault()
    el.scrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, el.scrollLeft + e.deltaY),
    )
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Mouse primary button only; touch/pen keep native pan via touch-action.
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    // Interactive controls inside the strip should not start a drag.
    const target = e.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [role="button"]')) {
      return
    }

    const el = e.currentTarget
    ref.current = el
    const maxScrollLeft = el.scrollWidth - el.clientWidth
    if (maxScrollLeft <= 0) return

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
      moved: false,
      active: true,
    }
    // Capture early so pointerup still hits the strip if the cursor leaves.
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    if (!state.active || state.pointerId !== e.pointerId) return

    const el = e.currentTarget
    ref.current = el

    const dx = e.clientX - state.startX
    if (!state.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      state.moved = true
      setIsDragging(true)
    }

    e.preventDefault()
    const maxScrollLeft = el.scrollWidth - el.clientWidth
    el.scrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, state.startScrollLeft - dx),
    )
  }, [])

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      ref.current = e.currentTarget
      endDrag(e.currentTarget, e.pointerId)
    },
    [endDrag],
  )

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      ref.current = e.currentTarget
      endDrag(e.currentTarget, e.pointerId)
    },
    [endDrag],
  )

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return {
    ref,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
    className: isDragging
      ? 'cursor-grabbing select-none [&_*]:!cursor-grabbing'
      : 'cursor-grab',
    style: isDragging
      ? ({ scrollSnapType: 'none' } as CSSProperties)
      : undefined,
    isDragging,
  }
}
