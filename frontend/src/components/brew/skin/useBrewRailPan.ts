/** 轨道只做 transform，不设 overflow、不切遮罩。前一张从左边溢出，不退场。 */

import type { RefObject } from 'react'
import type { ConversationExitStyle } from '../../agent-panel/conversationPan'

import { useLayoutEffect, useRef } from 'react'
import {
  applyConversationExit,
  clampConversationScroll,
  CONVERSATION_FADE_PX,
  conversationExitKey,
  conversationExitStyle,

  rubberband,
  sampleVelocity,
  smoothToward,
  wheelDeltaY,
} from '../../agent-panel/conversationPan'
import {
  isDiscreteWheel,
  nearestRailSlot,
  neighborRailSlot,
  RAIL_OVERFLOW_LEFT_PX,
  RAIL_SEAT_PX,
  RAIL_WHEEL_SETTLE_MS,
  railCardKeepsPaint,
  railColumnSlotAt,
  railColumnSlots,
  railLeadIndex,
  railMaxScroll,
  railSeatScroll,
  railSeatSlots,
  railSettleTau,
  railSlotOffsets,
  scrollFromTrackTransform,
  settleRailSlot,
} from './railPan'

function applyRailExit(el: HTMLElement, style: ConversationExitStyle): void {
  applyConversationExit(el, style)
  if (!style.hidden) el.style.pointerEvents = ''
  if (style.hidden || style.exit <= 0.01) {
    el.style.removeProperty('--exit-x')
    return
  }
  el.style.setProperty('--exit-x', `${style.shift}px`)
}

export interface BrewRailCard {
  id: number
  left: number
}

export interface BrewRailApi {
  align: (id: number, immediate?: boolean) => void
  /** 轨上卡片变了：重测；前面插入时把滚动补回去，视觉不动。 */
  relayout: () => void
  /** 只换实装窗口：重挂卡，不挪滚动。 */
  refresh: () => void
  /** 跟着另一条轨走：立刻到位，不报焦点、不吸槽。 */
  seek: (scroll: number) => void
  /** 前面插入列时把滚动补上，不重测。 */
  nudge: (delta: number) => void
  cards: (fresh?: boolean) => BrewRailCard[]
}

function wheelDelta(event: WheelEvent): number {
  const dominant =
    Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY
  return wheelDeltaY(dominant, event.deltaMode)
}

export function useBrewRailPan(
  viewportRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: unknown,
  cardSelector: string,
  onLeadChange?: (id: number) => void,
  apiRef?: RefObject<BrewRailApi | null>,
  overflowLeft = false,
  onScroll?: (state: { scroll: number; viewW: number; colW: number }) => void,
  onGrab?: () => void,
  onIdle?: () => void,
): void {
  const onLeadChangeRef = useRef(onLeadChange)
  onLeadChangeRef.current = onLeadChange
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  const onGrabRef = useRef(onGrab)
  onGrabRef.current = onGrab
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useLayoutEffect(() => {
    if (!enabled) return
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let current = 0
    let target = 0
    let dragging = false
    let seating = false
    let touchX = 0
    let frame = 0
    let exitFrame = 0
    let settleTimer = 0
    let idleTimer = 0
    let grabOn = false
    let last = 0
    let wheelStarted = 0
    let wheelAcc = 0
    let wheelVel = 0
    let home = 0
    let viewW = 0
    let cards: Array<{
      el: HTMLElement
      left: number
      width: number
      col: number
      key: string
    }> = []
    let cardList: Array<{ id: number; left: number }> | null = null
    const SAMPLE_CAP = 12
    const samples: Array<{ t: number; x: number }> = Array.from(
      { length: SAMPLE_CAP },
      () => ({ t: 0, x: 0 }),
    )
    let sampleN = 0
    let sampleAt = 0
    const pushSample = (t: number, x: number) => {
      const slot = samples[sampleAt]
      if (!slot) return
      slot.t = t
      slot.x = x
      sampleAt = (sampleAt + 1) % SAMPLE_CAP
      if (sampleN < SAMPLE_CAP) sampleN += 1
    }
    const sampleView: Array<{ t: number; x: number }> = []
    const sampleList = () => {
      sampleView.length = 0
      const start = sampleN === SAMPLE_CAP ? sampleAt : 0
      for (let i = 0; i < sampleN; i++) {
        const slot = samples[(start + i) % SAMPLE_CAP]
        if (slot) sampleView.push(slot)
      }
      return sampleView
    }
    let lastLead = ''
    let colW = 0
    let totalCols = 0
    let rawSlots: number[] = [0]
    let seatSlots: number[] = [0]
    let scrollMax = 0
    const colLead = new Map<number, HTMLElement>()

    const overflowPx = overflowLeft ? RAIL_OVERFLOW_LEFT_PX : 0
    let slotsCols = 0
    let slotsColW = 0
    const rebuildSlots = () => {
      if (
        totalCols > 1
        && colW > 1
        && slotsCols === totalCols
        && Math.abs(slotsColW - colW) < 0.5
      ) {
        return
      }
      rawSlots =
        totalCols > 1 && colW > 1
          ? railColumnSlots(totalCols, colW)
          : railSlotOffsets(cards)
      seatSlots = railSeatSlots(rawSlots, overflowPx)
      scrollMax = railMaxScroll(rawSlots, overflowPx)
      slotsCols = totalCols
      slotsColW = colW
    }
    const slotsOf = () => seatSlots
    const maxScroll = () => scrollMax

    const slotAt = (scroll: number) =>
      totalCols > 1 && colW > 1
        ? railColumnSlotAt(scroll, colW, maxScroll())
        : nearestRailSlot(scroll, slotsOf(), maxScroll())

    const restOnSlot = (scroll: number) =>
      Math.abs(scroll - slotAt(scroll)) <= 0.6

    const recache = () => {
      cardList = null
      const inline = track.style.getPropertyValue('--brew-story-cols')
      const raw = Number.parseFloat(
        inline || getComputedStyle(track).getPropertyValue('--brew-story-cols'),
      )
      const cols = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
      if (cols > 0) totalCols = cols
      if (cols > 1 && cards.length > 0) {
        const first = cards.find((card) => card.col > 0 && card.el.isConnected)
        const other = first
          ? cards.find(
              (card) =>
                card.col > 0
                && card.col !== first.col
                && card.el.isConnected,
            )
          : undefined
        if (first && other) {
          const width =
            Math.abs(other.el.offsetLeft - first.el.offsetLeft)
            / Math.abs(other.col - first.col)
          if (width > 1) colW = width
          rebuildSlots()
          return
        }
        if (first && first.el.offsetWidth > 1) {
          colW = first.el.offsetWidth + 12
          rebuildSlots()
          return
        }
      }
      if (cols > 1 && colW > 1) {
        rebuildSlots()
        return
      }
      const prevByEl = new Map(cards.map((card) => [card.el, card]))
      const nextCards: typeof cards = []
      for (const el of track.querySelectorAll<HTMLElement>(cardSelector)) {
        const old = prevByEl.get(el)
        nextCards.push({
          el,
          left: old?.left ?? 0,
          width: old?.width ?? 0,
          col: Number(el.dataset.railCol) || 0,
          key: old?.key ?? '',
        })
      }
      cards = nextCards
      colLead.clear()
      const withCol: typeof cards = []
      for (const card of cards) {
        if (card.col > 0) {
          withCol.push(card)
          if (!colLead.has(card.col)) colLead.set(card.col, card.el)
        }
      }
      const first = withCol[0]
      const other = first
        ? withCol.find((card) => card.col !== first.col)
        : undefined
      if (first && other) {
        const width =
          Math.abs(other.el.offsetLeft - first.el.offsetLeft)
          / Math.abs(other.col - first.col)
        if (width > 1) colW = width
      } else if (first && first.el.offsetWidth > 1) {
        colW = first.el.offsetWidth + 12
      }
      if (first && colW > 1) {
        const origin = first.el.offsetLeft - (first.col - 1) * colW
        const width = first.el.offsetWidth || colW
        for (const card of cards) {
          if (card.col > 0) {
            card.left = origin + (card.col - 1) * colW
            card.width = width
            continue
          }
          card.left = card.el.offsetLeft
          card.width = card.el.offsetWidth
        }
      } else {
        for (const card of cards) {
          card.left = card.el.offsetLeft
          card.width = card.el.offsetWidth
        }
      }
      rebuildSlots()
    }

    const syncColumnSlots = () => {
      const raw = Number.parseFloat(
        track.style.getPropertyValue('--brew-story-cols'),
      )
      const cols = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
      if (cols <= 1 || colW <= 1 || cols === totalCols) return
      totalCols = cols
      rebuildSlots()
    }

    const measure = () => {
      viewW = viewport.clientWidth
    }

    const clearExit = () => {
      for (const card of cards) {
        applyRailExit(card.el, { exit: 0, shift: 0, hidden: false })
        card.key = ''
      }
    }

    const writeExit = () => {
      if (viewW < 32) return
      const fade = CONVERSATION_FADE_PX
      const band = Math.max(colW * 2, 360)
      for (const card of cards) {
        const left = card.left - current
        if (left > viewW + band || left + card.width < -band) continue
        const right = left + card.width
        if (railCardKeepsPaint(left, overflowLeft, fade)) {
          if (card.key === 'r') continue
          card.key = 'r'
          applyRailExit(card.el, { exit: 0, shift: 0, hidden: false })
          continue
        }
        const style = conversationExitStyle(left, right, 0, viewW, fade)
        const key = conversationExitKey(style)
        if (key === card.key) continue
        card.key = key
        applyRailExit(card.el, style)
      }
    }

    let lastScrollAttr = ''
    let lastTransform = ''
    const persistScroll = () => {
      const attr = String(Math.round(current))
      if (attr === lastScrollAttr) return
      lastScrollAttr = attr
      track.dataset.brewRailScroll = attr
    }
    const writeTransform = () => {
      const max = maxScroll()
      const next = max > 0 ? `translate3d(${-current}px, 0, 0)` : ''
      if (next !== lastTransform) {
        lastTransform = next
        track.style.transform = next
      }
    }

    const leadElAt = (scroll: number) => {
      if (totalCols > 1 && colW > 1) {
        const col = Math.min(
          totalCols,
          Math.max(1, Math.floor(Math.max(0, scroll) / colW) + 1),
        )
        let el = colLead.get(col) ?? null
        if (!el) {
          el = track.querySelector<HTMLElement>(`[data-rail-col="${col}"]`)
          if (el) colLead.set(col, el)
        }
        return el
      }
      const index = railLeadIndex(cards, scroll, viewW)
      return index >= 0 ? (cards[index]?.el ?? null) : null
    }

    const notifyLead = (el: HTMLElement | null) => {
      const notify = onLeadChangeRef.current
      const id = el?.dataset.railId ?? ''
      if (!id || id === lastLead) return
      lastLead = id
      const parsed = Number(id)
      if (Number.isFinite(parsed)) notify?.(parsed)
    }

    let lastLeadCol = 0
    const reportLead = () => {
      if (!onLeadChangeRef.current) return
      if (seating && Math.abs(current - target) > 1) return
      if (totalCols > 1 && colW > 1) {
        const col = Math.min(
          totalCols,
          Math.max(1, Math.floor(Math.max(0, current) / colW) + 1),
        )
        if (col === lastLeadCol) return
        lastLeadCol = col
      }
      notifyLead(leadElAt(current))
    }

    const notifyLeadAt = (scroll: number) => {
      if (!onLeadChangeRef.current) return
      notifyLead(leadElAt(scroll))
    }

    const scheduleExit = () => {
      if (overflowLeft) return
      if (exitFrame) return
      exitFrame = requestAnimationFrame(() => {
        exitFrame = 0
        writeExit()
      })
    }

    let lastScrollNotify = Number.NaN
    let lastViewNotify = -1
    let lastColNotify = -1
    let scrollNotifyFrame = 0
    const scrollState = { scroll: 0, viewW: 0, colW: 0 }
    const flushScrollNotify = () => {
      scrollNotifyFrame = 0
      const notify = onScrollRef.current
      if (
        !notify
        || (
          Math.abs(current - lastScrollNotify) < 0.5
          && viewW === lastViewNotify
          && Math.abs(colW - lastColNotify) < 0.5
        )
      ) {
        return
      }
      lastScrollNotify = current
      lastViewNotify = viewW
      lastColNotify = colW
      scrollState.scroll = current
      scrollState.viewW = viewW
      scrollState.colW = colW
      notify(scrollState)
    }
    const notifyScroll = (immediate = false) => {
      if (!onScrollRef.current) return
      if (immediate) {
        if (scrollNotifyFrame) {
          window.cancelAnimationFrame(scrollNotifyFrame)
          scrollNotifyFrame = 0
        }
        flushScrollNotify()
        return
      }
      if (scrollNotifyFrame) return
      scrollNotifyFrame = window.requestAnimationFrame(flushScrollNotify)
    }
    let restoreArmed = false
    const write = (syncScroll = false) => {
      if (restoreArmed) {
        restoreArmed = false
        const pending = track.dataset.brewRailRestore
        if (pending != null && pending !== '') {
          const next = Number(pending)
          delete track.dataset.brewRailRestore
          if (Number.isFinite(next)) {
            current = next
            target = next
          }
        }
      }
      writeTransform()
      if (!overflowLeft) scheduleExit()
      if (onLeadChangeRef.current) reportLead()
      notifyScroll(syncScroll)
    }

    const clearSettleTimer = () => {
      if (!settleTimer) return
      window.clearTimeout(settleTimer)
      settleTimer = 0
    }

    const clearIdleTimer = () => {
      if (!idleTimer) return
      window.clearTimeout(idleTimer)
      idleTimer = 0
    }

    const beginGrab = () => {
      clearIdleTimer()
      if (grabOn) return
      grabOn = true
      onGrabRef.current?.()
    }

    const releaseGrab = () => {
      clearIdleTimer()
      track.style.willChange = ''
      if (!grabOn) return
      grabOn = false
      onIdleRef.current?.()
    }

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      if (exitFrame) cancelAnimationFrame(exitFrame)
      if (scrollNotifyFrame) {
        window.cancelAnimationFrame(scrollNotifyFrame)
        flushScrollNotify()
      }
      frame = 0
      exitFrame = 0
      last = 0
      persistScroll()
      clearIdleTimer()
      idleTimer = window.setTimeout(() => {
        idleTimer = 0
        track.style.willChange = ''
        if (!grabOn) return
        grabOn = false
        onIdleRef.current?.()
      }, RAIL_WHEEL_SETTLE_MS)
    }

    const tick = (now: number) => {
      const dt = last ? Math.min(0.032, (now - last) / 1000) : 1 / 60
      last = now
      const max = maxScroll()

      if (!dragging) target = clampConversationScroll(target, max)
      current = reduce
        ? target
        : smoothToward(
            current,
            target,
            dt,
            railSettleTau(target - current, seating),
          )

      const arrived =
        !dragging &&
        Math.abs(target - current) <= (seating ? RAIL_SEAT_PX : 0.35)
      if (!arrived) {
        write(true)
        frame = requestAnimationFrame(tick)
        return
      }
      current = target
      if (!dragging && !restOnSlot(current)) {
        seating = true
        target = settleRailSlot(current, wheelVel, slotsOf(), max, home)
        home = target
        notifyLeadAt(target)
        if (Math.abs(target - current) > 0.35 && !reduce) {
          write(true)
          frame = requestAnimationFrame(tick)
          return
        }
        current = target
      }
      seating = false
      write(true)
      stop()
    }

    const kick = () => {
      if (maxScroll() > 0) track.style.willChange = 'transform'
      if (!frame) frame = requestAnimationFrame(tick)
    }

    const snapTo = (scroll: number) => {
      clearSettleTimer()
      clearIdleTimer()
      seating = true
      target = clampConversationScroll(scroll, maxScroll())
      home = slotAt(target)
      notifyLeadAt(target)
      if (reduce) {
        current = target
        seating = false
        write(true)
        return
      }
      kick()
    }

    const align = (id: number, immediate = false) => {
      const known = track.querySelector<HTMLElement>(`[data-rail-id="${id}"]`)
      let col = Number(known?.dataset.railCol) || 0
      let index = -1
      if (col <= 0 || colW <= 1) {
        recache()
        measure()
        index = cards.findIndex((item) => Number(item.el.dataset.railId) === id)
        if (index < 0) return
        col = cards[index]?.col ?? 0
      }
      if (viewW < 32) measure()
      lastLead = String(id)
      const x = clampConversationScroll(
        col > 0 && colW > 1
          ? (col - 1) * colW
          : railSeatScroll(cards, Math.max(0, index), overflowPx),
        maxScroll(),
      )
      if (immediate) {
        current = x
        target = x
        home = slotAt(x)
        seating = false
        writeTransform()
        persistScroll()
        writeExit()
        return
      }
      snapTo(x)
    }

    const relayout = () => {
      const anchor = leadElAt(current) ?? cards[0]?.el ?? null
      const anchorId = anchor?.dataset.railId
      const oldLeft = anchor?.offsetLeft ?? 0
      recache()
      measure()
      if (anchorId) {
        const next = cards.find((item) => item.el.dataset.railId === anchorId)
        if (next) {
          const shift = next.left - oldLeft
          if (Math.abs(shift) > 0.5) {
            current += shift
            target += shift
            home += shift
          }
        }
      }
      write(true)
    }

    const refresh = () => {
      recache()
      measure()
      writeTransform()
      persistScroll()
      scheduleExit()
    }

    const nudge = (delta: number) => {
      if (Math.abs(delta) < 0.5) return
      syncColumnSlots()
      const next = clampConversationScroll(current + delta, maxScroll())
      if (Math.abs(next - current) < 0.5) return
      current = next
      target = next
      home = slotAt(current)
      writeTransform()
      persistScroll()
      notifyScroll(true)
    }

    const seek = (scroll: number) => {
      if (!cards.length) {
        recache()
        measure()
      }
      const next = clampConversationScroll(scroll, maxScroll())
      if (Math.abs(next - current) < 0.5 && Math.abs(next - target) < 0.5) return
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
        last = 0
      }
      seating = false
      current = next
      target = next
      writeTransform()
    }

    if (apiRef) {
      apiRef.current = {
        align,
        relayout,
        refresh,
        seek,
        nudge,
        cards: (fresh = false) => {
          if (fresh || !cards.length) recache()
          if (!cardList) {
            const next: Array<{ id: number; left: number }> = []
            for (const card of cards) {
              const id = Number(card.el.dataset.railId)
              if (Number.isFinite(id)) next.push({ id, left: card.left })
            }
            cardList = next
          }
          return cardList
        },
      }
    }

    const onWheel = (event: WheelEvent) => {
      beginGrab()
      if (event.ctrlKey) return
      if (!cards.length) recache()
      if (viewW < 32) measure()
      const max = maxScroll()
      if (max <= 0) {
        persistScroll()
        releaseGrab()
        return
      }
      event.preventDefault()
      const delta = wheelDelta(event)
      if (delta === 0) return
      dragging = false

      if (isDiscreteWheel(event)) {
        wheelAcc = 0
        wheelStarted = 0
        wheelVel = 0
        const dir = Math.sign(delta) || 1
        snapTo(neighborRailSlot(target, dir, slotsOf(), max))
        return
      }

      const now = event.timeStamp
      const slots = slotsOf()

      if (!wheelStarted) {
        wheelStarted = now
        home = slotAt(current)
        wheelAcc = 0
      }
      wheelAcc += delta
      wheelVel = wheelAcc / Math.max((now - wheelStarted) / 1000, 0.016)

      const pos = clampConversationScroll(home + wheelAcc, max)
      const committed = settleRailSlot(pos, 0, slots, max, home)

      const armIdle = () => {
        clearSettleTimer()
        settleTimer = window.setTimeout(() => {
          settleTimer = 0
          if (viewW < 32) measure()
          const end = settleRailSlot(
            home + wheelAcc,
            wheelVel,
            slotsOf(),
            maxScroll(),
            home,
          )
          wheelAcc = 0
          wheelStarted = 0
          wheelVel = 0
          if (Math.abs(end - current) > 0.6 || !restOnSlot(current)) {
            snapTo(end)
            return
          }
          persistScroll()
          releaseGrab()
        }, RAIL_WHEEL_SETTLE_MS)
      }

      if (Math.abs(committed - home) > 0.6) {
        seating = true
        if (Math.abs(committed - target) > 0.6) {
          target = committed
          notifyLeadAt(target)
        }
        armIdle()
        kick()
        return
      }

      seating = false
      target = pos
      current = pos
      armIdle()
      write()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      beginGrab()
      dragging = true
      seating = false
      home = slotAt(target)
      clearSettleTimer()
      touchX = event.touches[0].clientX
      sampleN = 0
      sampleAt = 0
      pushSample(event.timeStamp, target)
      last = 0
      track.style.willChange = 'transform'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!dragging || event.touches.length !== 1) return
      if (viewW < 32) measure()
      const max = maxScroll()
      if (max <= 0) return
      const x = event.touches[0].clientX
      const dx = touchX - x
      touchX = x
      if (dx === 0) return
      event.preventDefault()
      target = rubberband(target + dx, max, viewW)
      current = target
      pushSample(event.timeStamp, target)
      writeTransform()
      if (!overflowLeft) scheduleExit()
      if (onLeadChangeRef.current) reportLead()
      notifyScroll()
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!dragging) return
      dragging = false
      if (totalCols <= 1 || colW <= 1) recache()
      if (viewW < 32) measure()
      const max = maxScroll()
      const flung = sampleVelocity(sampleList(), event.timeStamp)
      sampleN = 0
      sampleAt = 0
      const raw = target
      target = clampConversationScroll(target, max)
      snapTo(settleRailSlot(raw, flung, slotsOf(), max, home))
    }

    recache()
    measure()
    const stored = Number(track.dataset.brewRailScroll)
    const seated = Number.isFinite(stored)
      ? stored
      : scrollFromTrackTransform(track.style.transform)
    current = seated
    target = seated
    home = slotAt(seated)
    const lead = leadElAt(seated)
    if (lead?.dataset.railId) lastLead = lead.dataset.railId
    writeTransform()
    persistScroll()
    writeExit()

    let lastBoxW = -1
    const resize = new ResizeObserver((entries) => {
      let trackChanged = false
      let viewChanged = false
      for (const entry of entries) {
        if (entry.target === viewport) viewChanged = true
        if (entry.target !== track) continue
        const boxW = entry.contentRect.width
        if (Math.abs(boxW - lastBoxW) > 0.5 || cards.length === 0) {
          lastBoxW = boxW
          trackChanged = true
        }
      }
      if (trackChanged && !dragging && !grabOn) recache()
      if (dragging || grabOn) return
      const prevView = viewW
      if (viewChanged || viewW < 32) measure()
      const max = maxScroll()
      const clamped = clampConversationScroll(current, max)
      if (Math.abs(clamped - current) > 0.5) {
        current = clamped
        target = clampConversationScroll(target, max)
        writeTransform()
        persistScroll()
      }
      if (Math.abs(viewW - prevView) <= 8) return
      target = settleRailSlot(target, 0, slotsOf(), max)
      if (Math.abs(target - current) > 0.35) {
        seating = true
        kick()
        return
      }
      current = target
      write(true)
      persistScroll()
    })
    resize.observe(track)
    resize.observe(viewport)
    const restore = new MutationObserver(() => {
      restoreArmed = true
      write(true)
    })
    restore.observe(track, {
      attributes: true,
      attributeFilter: ['data-brew-rail-restore'],
    })

    const onVis = () => {
      if (document.hidden) {
        stop()
        return
      }
      if (dragging || Math.abs(target - current) > RAIL_SEAT_PX) kick()
    }
    document.addEventListener('visibilitychange', onVis)
    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('touchstart', onTouchStart, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd)
    viewport.addEventListener('touchcancel', onTouchEnd)

    return () => {
      clearSettleTimer()
      clearIdleTimer()
      if (frame) cancelAnimationFrame(frame)
      if (exitFrame) cancelAnimationFrame(exitFrame)
      if (scrollNotifyFrame) window.cancelAnimationFrame(scrollNotifyFrame)
      frame = 0
      exitFrame = 0
      scrollNotifyFrame = 0
      persistScroll()
      releaseGrab()
      restore.disconnect()
      resize.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('touchend', onTouchEnd)
      viewport.removeEventListener('touchcancel', onTouchEnd)
      clearExit()
      if (apiRef) apiRef.current = null
    }
  }, [apiRef, cardSelector, enabled, overflowLeft, resetKey, trackRef, viewportRef])
}
