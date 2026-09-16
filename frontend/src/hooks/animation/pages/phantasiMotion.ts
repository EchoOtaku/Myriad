/** 一条链，后来的顶掉前一次收尾权。peek 不能抢走 intro / flip / lane。 */

export type PhantasiMotionLane = 'idle' | 'intro' | 'flip' | 'lane' | 'peek'

type PhantasiMotionListener = (lane: PhantasiMotionLane) => void

let token = 0
let lane: PhantasiMotionLane = 'idle'
const listeners = new Set<PhantasiMotionListener>()

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
  token += 1
  lane = next
  emit()
  return token
}

export function phantasiMotionOwns(id: number): boolean {
  return id > 0 && id === token
}

export function phantasiMotionRelease(id: number): void {
  if (id !== token) return
  lane = 'idle'
  emit()
}

export function phantasiMotionReset(): void {
  token += 1
  lane = 'idle'
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

function emit(): void {
  for (const fn of listeners) fn(lane)
}
