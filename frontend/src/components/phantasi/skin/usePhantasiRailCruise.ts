/** 闲着时按槽位循环；悬停、拖动手、减动画时停。 */

import type { RefObject } from 'react'
import type { PhantasiRailApi } from './usePhantasiRailPan'

import { useCallback, useLayoutEffect, useRef } from 'react'
import {
  RAIL_CRUISE_HOLD_MS,
  RAIL_CRUISE_RESUME_MS,
  RAIL_CRUISE_SEAT_MS,
  RAIL_CRUISE_START_MS,
  railCruiseCol,
  railCruiseNextCol,
  railLoopCol,
} from './railCruise'

export function usePhantasiRailCruise(
  apiRef: RefObject<PhantasiRailApi | null>,
  viewportRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  loopCols: number,
): { onGrab: () => void; onIdle: () => void } {
  const grabRef = useRef(false)
  const hoverRef = useRef(false)
  const stopRef = useRef<() => void>(() => {})
  const resumeRef = useRef<(delay?: number) => void>(() => {})

  const onGrab = useCallback(() => {
    grabRef.current = true
    stopRef.current()
  }, [])

  const onIdle = useCallback(() => {
    grabRef.current = false
    if (!hoverRef.current) resumeRef.current(RAIL_CRUISE_RESUME_MS)
  }, [])

  useLayoutEffect(() => {
    stopRef.current = () => {}
    resumeRef.current = () => {}
    if (!enabled || loopCols <= 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let wait = 0

    const clearWait = () => {
      if (!wait) return
      window.clearTimeout(wait)
      wait = 0
    }

    const blocked = () =>
      grabRef.current || hoverRef.current || document.hidden

    const later = (ms: number, fn: () => void) => {
      clearWait()
      wait = window.setTimeout(() => {
        wait = 0
        fn()
      }, ms)
    }

    const parkIfEcho = () => {
      const api = apiRef.current
      if (!api) return
      const { scroll, colW } = api.range()
      if (colW <= 1) return
      const col = railCruiseCol(scroll, colW)
      if (col > loopCols) api.alignColumn(railLoopCol(col, loopCols), true)
    }

    const advance = () => {
      if (blocked()) return
      const api = apiRef.current
      if (!api) {
        later(200, advance)
        return
      }
      const { scroll, colW } = api.range()
      if (colW <= 1) {
        later(200, advance)
        return
      }
      const next = railCruiseNextCol(railCruiseCol(scroll, colW), loopCols)
      api.alignColumn(next.align, false, true)
      later(RAIL_CRUISE_SEAT_MS, () => {
        if (blocked()) return
        if (next.reset != null) api.alignColumn(next.reset, true)
        later(RAIL_CRUISE_HOLD_MS, advance)
      })
    }

    const resume = (delay = RAIL_CRUISE_START_MS) => {
      if (blocked()) return
      later(delay, () => {
        if (blocked()) return
        parkIfEcho()
        advance()
      })
    }

    stopRef.current = clearWait
    resumeRef.current = resume

    const onEnter = () => {
      hoverRef.current = true
      clearWait()
    }
    const onLeave = () => {
      hoverRef.current = false
      if (!grabRef.current) resume(RAIL_CRUISE_RESUME_MS)
    }
    const onVis = () => {
      if (document.hidden) {
        clearWait()
        return
      }
      if (!blocked()) resume(RAIL_CRUISE_RESUME_MS)
    }

    hoverRef.current = viewport.matches(':hover')
    viewport.addEventListener('pointerenter', onEnter)
    viewport.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVis)
    if (!hoverRef.current) resume(RAIL_CRUISE_START_MS)

    return () => {
      clearWait()
      viewport.removeEventListener('pointerenter', onEnter)
      viewport.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
      stopRef.current = () => {}
      resumeRef.current = () => {}
    }
  }, [apiRef, enabled, loopCols, viewportRef])

  return { onGrab, onIdle }
}
