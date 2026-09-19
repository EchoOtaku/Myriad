import { useEffect, useState } from 'react'
import { isPageVisible, onVisibility } from '../../hooks/animation/core'

/** Carousel timing is independent of notification delivery and shell morphing. */
export function useIslandCarousel(count: number, paused: boolean, durationScale: number) {
  const [currentContentIndex, setCurrentContentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  useEffect(() => {
    if (
      count > 0 &&
      currentContentIndex >= count
    ) {
      setCurrentContentIndex(0)
    }
  }, [count, currentContentIndex])

  useEffect(() => {
    if (count === 0 || paused) {
      // 淡出窗口内依赖变化会取消换页定时器，必须同步撤销淡出，否则内容停在 hidden。
      setIsTransitioning(false)
      return
    }

    let cycleTimerId: number | null = null
    let swapTimerId: number | null = null
    let revealTimerId: number | null = null
    let cancelled = false

    const clearTimers = () => {
      if (cycleTimerId !== null) {
        clearTimeout(cycleTimerId)
        cycleTimerId = null
      }
      if (swapTimerId !== null) {
        clearTimeout(swapTimerId)
        swapTimerId = null
      }
      if (revealTimerId !== null) {
        clearTimeout(revealTimerId)
        revealTimerId = null
      }
    }

    const cycle = () => {
      if (cancelled || !isPageVisible()) return
      setIsTransitioning(true)
      swapTimerId = window.setTimeout(() => {
        swapTimerId = null
        if (cancelled) return
        setCurrentContentIndex((prev) => (prev + 1) % count)
        revealTimerId = window.setTimeout(() => {
          revealTimerId = null
          if (!cancelled) setIsTransitioning(false)
        }, 80)
        const base = 15000
        const nextDelay = Math.round(base * (durationScale || 1))
        cycleTimerId = window.setTimeout(cycle, nextDelay)
      }, 300)
    }

    const startDelay = Math.round(6000 * (durationScale || 1))
    if (isPageVisible()) cycleTimerId = window.setTimeout(cycle, startDelay)

    const handleVisibility = () => {
      if (!isPageVisible()) {
        // 隐藏时中止过渡，避免停在已淡出未换页的中间态。
        clearTimers()
        setIsTransitioning(false)
      } else if (!cancelled) {
        clearTimers()
        setIsTransitioning(false)
        const restartDelay = Math.round(2000 * (durationScale || 1))
        cycleTimerId = window.setTimeout(cycle, restartDelay)
      }
    }
    const unsubscribeVisibility = onVisibility(handleVisibility)

    return () => {
      cancelled = true
      clearTimers()
      setIsTransitioning(false)
      unsubscribeVisibility()
    }
  }, [count, paused, durationScale])

  return { currentContentIndex, setCurrentContentIndex, isTransitioning }
}
