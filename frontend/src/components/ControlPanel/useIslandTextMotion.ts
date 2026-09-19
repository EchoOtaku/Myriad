import type { DynamicContent } from './islandContentTypes'
import { useEffect, useRef, useState } from 'react'
import { batchRead, batchWrite, observeResize } from '../../hooks/animation'

type TextContent = Pick<DynamicContent, 'type' | 'text' | 'lyricDuration'>
const SCROLL_PROPERTIES = ['--scroll-distance', '--scroll-duration', '--scroll-delay'] as const

/** Own all work that can outlive a particular island text, including queued frames. */
export function useIslandTextMotion(content: TextContent | null, enabled: boolean) {
  const textRef = useRef<HTMLSpanElement>(null)
  const previous = useRef<{ type: string, text: string } | null>(null)
  const [needsScroll, setNeedsScroll] = useState(false)
  const type = content?.type
  const text = content?.text
  const lyricDuration = content?.lyricDuration

  useEffect(() => {
    const element = textRef.current
    const changed = type === 'music' && previous.current?.type === 'music' &&
      previous.current.text !== text
    previous.current = type && text ? { type, text } : null
    if (!element || !changed) return
    element.classList.add('lyric-transition')
    const timer = setTimeout(() => element.classList.remove('lyric-transition'), 100)
    return () => {
      clearTimeout(timer)
      element.classList.remove('lyric-transition')
    }
  }, [type, text])

  useEffect(() => {
    const element = textRef.current
    setNeedsScroll(false)
    if (!element || !enabled || !text) return
    let disposed = false
    let revision = 0
    let restartFrame: number | null = null
    let lastHeight = -1

    const measure = () => {
      const requested = ++revision
      let height = 0
      batchRead(() => {
        if (!disposed && requested === revision) height = element.scrollHeight
      })
      batchWrite(() => {
        if (disposed || requested !== revision || height === lastHeight) return
        lastHeight = height
        const overflow = height - 34
        if (restartFrame !== null) cancelAnimationFrame(restartFrame)
        restartFrame = null
        setNeedsScroll(false)
        if (overflow <= 5) {
          for (const property of SCROLL_PROPERTIES) element.style.removeProperty(property)
          return
        }
        const duration = type === 'music'
          ? lyricDuration ? Math.max(1.5, lyricDuration - 0.5) : 4
          : Math.max(10, Math.min(20, Math.ceil(overflow / 20) + 10))
        const delay = type === 'music' ? lyricDuration ? '0.3s' : '0.5s' : '1.5s'
        element.style.setProperty('--scroll-distance', `-${overflow}px`)
        element.style.setProperty('--scroll-duration', `${duration}s`)
        element.style.setProperty('--scroll-delay', delay)
        restartFrame = requestAnimationFrame(() => {
          restartFrame = null
          if (!disposed) setNeedsScroll(true)
        })
      })
    }
    const unobserve = observeResize(element, measure)
    measure()
    return () => {
      disposed = true
      unobserve()
      if (restartFrame !== null) cancelAnimationFrame(restartFrame)
      for (const property of SCROLL_PROPERTIES) element.style.removeProperty(property)
    }
  }, [enabled, text, type, lyricDuration])

  return { textRef, needsScroll }
}
