/** 页内互斥链，占位走统一 AnimationCoordinator。peek 不能抢走 intro / flip / lane。 */

import { coordinator } from '../coordinator'
import { AnimationPriority, AnimationState } from '../types'

export type PhantasiMotionLane = 'idle' | 'intro' | 'flip' | 'lane' | 'peek'

export const PHANTASI_MOTION_SLOT = {
  intro: 'phantasi-intro',
  flip: 'phantasi-flip',
  lane: 'phantasi-lane',
  peek: 'phantasi-peek',
} as const

type PhantasiMotionListener = (lane: PhantasiMotionLane) => void

let token = 0
let lane: PhantasiMotionLane = 'idle'
const listeners = new Set<PhantasiMotionListener>()

function slotOf(
  next: Exclude<PhantasiMotionLane, 'idle'>,
): (typeof PHANTASI_MOTION_SLOT)[keyof typeof PHANTASI_MOTION_SLOT] {
  return PHANTASI_MOTION_SLOT[next]
}

function slotPriority(
  next: Exclude<PhantasiMotionLane, 'idle'>,
): AnimationPriority {
  return next === 'peek' ? AnimationPriority.ELEMENT : AnimationPriority.SECTION
}

function occupy(next: Exclude<PhantasiMotionLane, 'idle'>): void {
  coordinator.schedule({
    id: slotOf(next),
    priority: slotPriority(next),
  })
}

function vacate(prev: PhantasiMotionLane, completed: boolean): void {
  if (prev === 'idle') return
  const id = slotOf(prev)
  if (completed) coordinator.markCompleted(id)
  else coordinator.skip(id)
}

export function phantasiMotionQuiet(): boolean {
  if (typeof window === 'undefined') return true
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.getAttribute('data-perf-mode') === 'exlight'
  )
}

export function phantasiMotionLane(): PhantasiMotionLane {
  return lane
}

export function phantasiMotionBusy(): boolean {
  return lane === 'intro' || lane === 'flip' || lane === 'lane'
}

export function phantasiMotionClaim(
  next: Exclude<PhantasiMotionLane, 'idle'>,
): number {
  if (next === 'peek' && phantasiMotionBusy()) return 0
  if (lane !== 'idle' && lane !== next) vacate(lane, false)
  token += 1
  lane = next
  occupy(next)
  emit()
  return token
}

export function phantasiMotionOwns(id: number): boolean {
  return id > 0 && id === token
}

export function phantasiMotionRelease(id: number): void {
  if (id !== token) return
  const prev = lane
  lane = 'idle'
  vacate(prev, true)
  emit()
}

export function phantasiMotionReset(): void {
  token += 1
  const prev = lane
  lane = 'idle'
  vacate(prev, false)
  emit()
}

export function onPhantasiMotion(fn: PhantasiMotionListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function whenPhantasiMotionIdle(fn: () => void): () => void {
  let done = false
  const run = () => {
    if (done || phantasiMotionBusy()) return
    done = true
    off()
    fn()
  }
  const off = onPhantasiMotion(run)
  run()
  return () => {
    done = true
    off()
  }
}

/** 统一调度器放行 peek 槽后再画。被 skip 则停，由调用方空闲后重申领。 */
export function whenPhantasiPeekReady(fn: () => void): () => void {
  const id = PHANTASI_MOTION_SLOT.peek
  let done = false
  const run = (state: AnimationState) => {
    if (done) return
    if (state !== AnimationState.READY && state !== AnimationState.RUNNING) {
      return
    }
    done = true
    off()
    coordinator.markRunning(id)
    fn()
  }
  const off = coordinator.subscribe(id, run)
  return () => {
    done = true
    off()
  }
}

function emit(): void {
  for (const fn of listeners) fn(lane)
}
