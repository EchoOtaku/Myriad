import type { PeekStoryPreview } from './peekLane'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { cancelIdleTask, scheduleIdleTask } from '../../../hooks/animation'
import { onPhantasiMotion, phantasiMotionBusy } from '../../../hooks/animation/pages/phantasiMotion'
import { cancelArticlePrefetch, prefetchArticleDetails } from '../articlePrefetch'
import { storySourceFace } from '../notes/noteSiteSource'
import { notePeekPointer, resetPeekPointer } from './peekLane'
import { applyPeekFace, toPhantasiPeekFace, writePeekFace } from './PhantasiPeekAir'
import { cancelPhantasiPeekResume, clearPhantasiStoryPeeks, schedulePhantasiPeekResume } from './StoryCard'

/** One owner for wallpaper, card classes, resume jobs and article warm-up. */
export function usePeekSession(routeKey: string, blocked: boolean) {
  const live = useRef(false)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const activeId = useRef<number | null>(null)
  const dropPeekSession = useCallback(() => {
    activeId.current = null
    cancelIdleTask('phantasi-peek-warm')
    cancelPhantasiPeekResume()
    cancelArticlePrefetch()
    clearPhantasiStoryPeeks()
    writePeekFace(null)
  }, [])
  const handlePeekItem = useCallback((item: PeekStoryPreview) => {
    if (!live.current) return
    if (blockedRef.current || document.visibilityState === 'hidden') {
      dropPeekSession()
      return
    }
    applyPeekFace(toPhantasiPeekFace(item, storySourceFace(item)))
    if (activeId.current === item.id) return
    activeId.current = item.id
    cancelIdleTask('phantasi-peek-warm')
    cancelArticlePrefetch()
    scheduleIdleTask('phantasi-peek-warm', () => {
      if (!live.current || activeId.current !== item.id || phantasiMotionBusy()) return
      prefetchArticleDetails([item.id])
      void import('../PhantasiReader')
    }, { priority: 'low' })
  }, [dropPeekSession])
  const resumePeekAfterLane = useCallback(() => {
    if (!live.current || blockedRef.current || document.visibilityState === 'hidden') return
    schedulePhantasiPeekResume(handlePeekItem)
  }, [handlePeekItem])

  useLayoutEffect(() => {
    live.current = true
    const leave = () => { resetPeekPointer(); dropPeekSession() }
    const hide = () => { if (document.visibilityState === 'hidden') leave() }
    const move = (event: PointerEvent) => notePeekPointer(event)
    const touch = (event: PointerEvent) => { if (event.pointerType === 'touch') leave() }
    let swapping = phantasiMotionBusy()
    const off = onPhantasiMotion((lane) => {
      if (lane === 'intro' || lane === 'flip' || lane === 'lane') {
        swapping = true
        dropPeekSession()
      } else if (lane === 'idle' && swapping) {
        swapping = false
        resumePeekAfterLane()
      }
    })
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerdown', touch)
    document.addEventListener('pointercancel', leave)
    document.addEventListener('visibilitychange', hide)
    document.documentElement.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    window.addEventListener('pagehide', leave)
    return () => {
      live.current = false
      off()
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerdown', touch)
      document.removeEventListener('pointercancel', leave)
      document.removeEventListener('visibilitychange', hide)
      document.documentElement.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [dropPeekSession, resumePeekAfterLane])

  useLayoutEffect(() => {
    dropPeekSession()
    if (!blocked) resumePeekAfterLane()
  }, [routeKey, blocked, dropPeekSession, resumePeekAfterLane])

  const handlePeekEnd = useCallback(() => {
    if (live.current) dropPeekSession()
  }, [dropPeekSession])

  return { handlePeekItem, handlePeekEnd, resumePeekAfterLane }
}
