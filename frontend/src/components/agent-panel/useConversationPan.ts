/**
 * 对话列表的位移滚动：跟手、有惯性，不给列表设 overflow。
 */

import type { RefObject } from 'react'
import { useLayoutEffect } from 'react'
import {
  applyConversationExit,
  clampConversationScroll,
  CONVERSATION_FADE_PX,
  CONVERSATION_FLING_TAU,
  CONVERSATION_FOLLOW_TAU,
  CONVERSATION_NEAR_BOTTOM_PX,
  conversationExitKey,
  conversationExitStyle,
  conversationMaxScroll,
  conversationViewHeight,
  decayVelocity,
  rubberband,
  sampleVelocity,
  smoothToward,
  stillCoasting,
  wheelDeltaY,
} from './conversationPan'

interface Card {
  el: HTMLElement
  top: number
  height: number
  key: string
}

export function useConversationPan(
  viewportRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: unknown,
): void {
  useLayoutEffect(() => {
    if (!enabled) return
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let current = 0
    let target = 0
    let velocity = 0
    let nearBottom = true
    let dragging = false
    let touchY = 0
    let frame = 0
    let last = 0
    let trackH = 0
    let viewH = 0
    let cards: Card[] = []
    const samples: Array<{ t: number; x: number }> = []

    const maxScroll = () => conversationMaxScroll(trackH, viewH)

    const recache = () => {
      cards = [
        ...track.querySelectorAll<HTMLElement>('.agent-panel-message'),
      ].map((el) => {
        const box =
          (el.closest('.agent-panel-presence') as HTMLElement | null) ?? el
        return {
          el,
          top: box.offsetTop,
          height: box.offsetHeight,
          key: '',
        }
      })
    }

    const measure = () => {
      trackH = track.offsetHeight
      const anchor = viewport.closest('.agent-panel-overlay-anchor')
      if (anchor instanceof HTMLElement) {
        const composer = anchor.querySelector('.agent-panel-composer')
        const rail = anchor.querySelector('.agent-panel-tag-rail')
        const gap = Number.parseFloat(getComputedStyle(anchor).rowGap) || 12
        const reserved =
          (composer instanceof HTMLElement ? composer.offsetHeight : 0) +
          (rail instanceof HTMLElement ? rail.offsetHeight : 0) +
          gap
        viewH = conversationViewHeight(trackH, anchor.clientHeight - reserved)
      } else {
        viewH = viewport.clientHeight
      }
    }

    const writeExit = () => {
      if (viewH < 32) return
      for (const card of cards) {
        const style = conversationExitStyle(
          card.top - current,
          card.top + card.height - current,
          0,
          viewH,
          CONVERSATION_FADE_PX,
        )
        const key = conversationExitKey(style)
        if (key === card.key) continue
        card.key = key
        applyConversationExit(card.el, style)
      }
    }

    const writeCap = (max: number) => {
      const on = max > 0
      viewport.dataset.capped = on ? 'true' : 'false'
      const anchor = viewport.closest('.agent-panel-overlay-anchor')
      if (anchor instanceof HTMLElement) {
        anchor.dataset.capped = on ? 'true' : 'false'
      }
    }

    const write = () => {
      const max = maxScroll()
      writeCap(max)
      track.style.transform = max > 0 ? `translate3d(0, ${-current}px, 0)` : ''
      writeExit()
    }

    const clearExit = () => {
      for (const card of cards) {
        applyConversationExit(card.el, { exit: 0, shift: 0, hidden: false })
        card.key = ''
      }
    }

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      last = 0
      track.style.willChange = ''
    }

    const tick = (now: number) => {
      const dt = last ? Math.min(0.032, (now - last) / 1000) : 1 / 60
      last = now
      const max = maxScroll()

      if (!dragging && velocity !== 0) {
        target += velocity * dt
        velocity = decayVelocity(velocity, dt, CONVERSATION_FLING_TAU)
        if (target < 0 || target > max) {
          target = clampConversationScroll(target, max)
          velocity = 0
        }
      } else if (!dragging) {
        velocity = 0
      }

      if (nearBottom && !dragging) target = max
      if (!dragging) target = clampConversationScroll(target, max)
      current = reduce
        ? target
        : smoothToward(current, target, dt, CONVERSATION_FOLLOW_TAU)
      write()

      if (stillCoasting(current, target, velocity, dragging)) {
        frame = requestAnimationFrame(tick)
      } else {
        current = target
        write()
        stop()
      }
    }

    const kick = () => {
      track.style.willChange = 'transform'
      if (!frame) frame = requestAnimationFrame(tick)
    }

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      measure()
      const max = maxScroll()
      if (max <= 0) return
      event.preventDefault()
      velocity = 0
      target = clampConversationScroll(
        target + wheelDeltaY(event.deltaY, event.deltaMode),
        max,
      )
      nearBottom = max - target <= CONVERSATION_NEAR_BOTTOM_PX
      kick()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      dragging = true
      velocity = 0
      touchY = event.touches[0].clientY
      samples.length = 0
      samples.push({ t: event.timeStamp, x: target })
      last = 0
      track.style.willChange = 'transform'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!dragging || event.touches.length !== 1) return
      measure()
      const max = maxScroll()
      if (max <= 0) return
      const y = event.touches[0].clientY
      const dy = touchY - y
      touchY = y
      if (dy === 0) return
      event.preventDefault()
      target = rubberband(target + dy, max, viewH)
      current = target
      nearBottom =
        max - clampConversationScroll(target, max) <=
        CONVERSATION_NEAR_BOTTOM_PX
      samples.push({ t: event.timeStamp, x: target })
      if (samples.length > 12) samples.shift()
      write()
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!dragging) return
      dragging = false
      measure()
      const max = maxScroll()
      velocity = sampleVelocity(samples, event.timeStamp)
      samples.length = 0
      if (target < 0 || target > max) {
        target = clampConversationScroll(target, max)
        velocity = 0
      }
      nearBottom = max - target <= CONVERSATION_NEAR_BOTTOM_PX
      kick()
    }

    measure()
    recache()
    if (nearBottom) target = maxScroll()
    current = target
    write()

    const resize = new ResizeObserver(() => {
      measure()
      recache()
      if (nearBottom) target = maxScroll()
      kick()
    })
    resize.observe(viewport)
    resize.observe(track)
    if (viewport.parentElement) resize.observe(viewport.parentElement)
    const anchor = viewport.closest('.agent-panel-overlay-anchor')
    if (anchor instanceof HTMLElement) resize.observe(anchor)
    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('touchstart', onTouchStart, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd)
    viewport.addEventListener('touchcancel', onTouchEnd)

    return () => {
      stop()
      resize.disconnect()
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('touchend', onTouchEnd)
      viewport.removeEventListener('touchcancel', onTouchEnd)
      track.style.transform = ''
      delete viewport.dataset.capped
      const anchor = viewport.closest('.agent-panel-overlay-anchor')
      if (anchor instanceof HTMLElement) delete anchor.dataset.capped
      clearExit()
    }
  }, [enabled, resetKey, trackRef, viewportRef])
}
