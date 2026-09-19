/** Pace visual work without rounding 60 Hz up to 17 ms or losing remainder. */
export function createFrameClock(fps: number) {
  const interval = 1000 / fps
  let previous = 0
  let next = 0

  return {
    reset(now: number) {
      previous = now
      next = now + interval
    },
    advance(now: number): number | null {
      // rAF timestamps have fractional-millisecond jitter at the boundary.
      if (now + 0.5 < next) return null
      const delta = now - previous
      previous = now
      // Skip missed slots after a stall; never run a catch-up burst.
      next += Math.max(1, Math.floor((now + 0.5 - next) / interval) + 1) * interval
      return delta
    },
  }
}
