/**
 * 对话列表的位移滚动：跟手、有惯性，不给列表设 overflow。
 */

import type { RefObject } from 'react'
import { useLayoutEffect, useRef } from 'react'
import {
  applyConversationExit,
  clampConversationScroll,
  CONVERSATION_FADE_PX,
  CONVERSATION_FLING_TAU,
  CONVERSATION_FOLLOW_TAU,
  CONVERSATION_LOAD_MORE_PX,
  CONVERSATION_NEAR_BOTTOM_PX,
  conversationExitKey,
  conversationExitStyle,
  conversationMaxScroll,
  conversationShellLimit,
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
  cardSelector = '.agent-panel-message',
  onNearStart?: () => void,
): void {
  const nearStartRef = useRef(onNearStart)
  nearStartRef.current = onNearStart

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
    let exitFrame = 0
    let last = 0
    let trackH = 0
    let viewH = 0
    let cards: Card[] = []
    const samples: Array<{ t: number; x: number }> = []

    const maxScroll = () => conversationMaxScroll(trackH, viewH)

    const recache = () => {
      const nextH = track.offsetHeight
      if (trackH > 0 && nextH > trackH && !nearBottom) {
        const delta = nextH - trackH
        current += delta
        target += delta
      }
      trackH = nextH
      cards = [...track.querySelectorAll<HTMLElement>(cardSelector)].map(
        (el) => {
          const box =
            (el.closest('.agent-panel-presence') as HTMLElement | null) ?? el
          return {
            el,
            top: box.offsetTop,
            height: box.offsetHeight,
            key: '',
          }
        },
      )
    }

    const measure = () => {
      const anchor = viewport.closest('.agent-panel-overlay-anchor')
      if (anchor instanceof HTMLElement) {
        const style = getComputedStyle(anchor)
        const composer = anchor.querySelector('.agent-panel-composer')
        const rail = anchor.querySelector('.agent-panel-tag-rail')
        const gap = Number.parseFloat(style.rowGap) || 12
        const reserved =
          (composer instanceof HTMLElement ? composer.offsetHeight : 0) +
          (rail instanceof HTMLElement ? rail.offsetHeight : 0) +
          gap
        const shell = conversationShellLimit(
          Number.parseFloat(style.maxHeight),
          window.innerHeight,
        )
        viewH = conversationViewHeight(trackH, Math.max(48, shell - reserved))
      } else {
        viewH = viewport.clientHeight
      }
    }

    const clearExit = () => {
      for (const card of cards) {
        applyConversationExit(card.el, { exit: 0, shift: 0, hidden: false })
        card.key = ''
      }
    }

    const writeExit = () => {
      if (viewH < 32) return
      const shell = viewport.closest('.agent-panel-overlay-anchor')
      const leaving =
        (shell instanceof HTMLElement && shell.dataset.phase === 'closing') ||
        Boolean(viewport.closest('[data-exiting="true"]'))
      // 逐张收回时先去掉滚动模糊，免得和位移叠两层。
      if (leaving) {
        clearExit()
        return
      }
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

    const writeTransform = () => {
      const max = maxScroll()
      writeCap(max)
      track.style.transform = max > 0 ? `translate3d(0, ${-current}px, 0)` : ''
      if (max > 0 && current <= CONVERSATION_LOAD_MORE_PX) {
        nearStartRef.current?.()
      }
    }

    const scheduleExit = () => {
      if (exitFrame) return
      exitFrame = requestAnimationFrame(() => {
        exitFrame = 0
        writeExit()
      })
    }

    const write = () => {
      writeTransform()
      writeExit()
    }

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      if (exitFrame) cancelAnimationFrame(exitFrame)
      frame = 0
      exitFrame = 0
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

    const blocked = () =>
      (viewport.closest('.agent-panel-overlay-anchor') as HTMLElement | null)
        ?.dataset.phase === 'closing' ||
      Boolean(viewport.closest('[data-exiting="true"]'))

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || blocked()) return
      measure()
      const max = maxScroll()
      if (max <= 0) return
      event.preventDefault()
      velocity = 0
      target = clampConversationScroll(
        target + wheelDeltaY(event.deltaY, event.deltaMode),
        max,
      )
      current = target
      nearBottom = max - target <= CONVERSATION_NEAR_BOTTOM_PX
      track.style.willChange = 'transform'
      writeTransform()
      scheduleExit()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || blocked()) return
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
      writeTransform()
      scheduleExit()
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

    recache()
    measure()
    if (nearBottom) target = maxScroll()
    current = target
    write()

    const resize = new ResizeObserver(() => {
      recache()
      measure()
      if (nearBottom) target = maxScroll()
      kick()
    })
    resize.observe(viewport)
    resize.observe(track)
    if (viewport.parentElement) resize.observe(viewport.parentElement)
    const anchor = viewport.closest('.agent-panel-overlay-anchor')
    if (anchor instanceof HTMLElement) resize.observe(anchor)
    const phaseWatch = new MutationObserver(() => write())
    if (anchor instanceof HTMLElement) {
      phaseWatch.observe(anchor, {
        attributes: true,
        attributeFilter: ['data-phase'],
      })
    }
    const slot = viewport.closest('.agent-panel-messages-slot')
    if (slot instanceof HTMLElement) {
      phaseWatch.observe(slot, {
        attributes: true,
        attributeFilter: ['data-exiting'],
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('touchstart', onTouchStart, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd)
    viewport.addEventListener('touchcancel', onTouchEnd)

    return () => {
      stop()
      resize.disconnect()
      phaseWatch.disconnect()
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
  }, [cardSelector, enabled, resetKey, trackRef, viewportRef])
}
