/** 一条链，后来的顶掉前一次收尾权。入场不占 flip。ChipLane 不占 lane。 */
type PhantasiMotionLane = 'idle' | 'intro' | 'flip' | 'lane'

let token = 0
let lane: PhantasiMotionLane = 'idle'

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

export function phantasiMotionClaim(next: Exclude<PhantasiMotionLane, 'idle'>): number {
  token += 1
  lane = next
  return token
}

export function phantasiMotionOwns(id: number): boolean {
  return id === token
}

export function phantasiMotionRelease(id: number): void {
  if (id !== token) return
  lane = 'idle'
}

export function phantasiMotionReset(): void {
  token += 1
  lane = 'idle'
}
