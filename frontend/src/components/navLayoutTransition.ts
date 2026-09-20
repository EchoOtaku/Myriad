import type { NavLayout } from '../utils/navLayout'

interface LayoutTransitionOptions {
  current: () => NavLayout
  desired: () => NavLayout
  phase: (phase: 'out' | 'in' | null) => void
  commit: (layout: NavLayout) => void
  settled: () => void
}

/** One owner for the fade-out, hidden layout commit, fade-in and deferred recheck. */
export function createNavLayoutTransition(options: LayoutTransitionOptions) {
  let disposed = false
  let switching = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let frame: number | null = null

  const request = () => {
    if (disposed || switching || options.current() === options.desired()) return
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    switching = true
    options.phase('out')
    timer = setTimeout(() => {
      timer = null
      if (disposed) return
      // Read again at opacity zero: rapid resize commits the latest destination.
      options.commit(options.desired())
      options.phase('in')
      timer = setTimeout(() => {
        timer = null
        if (disposed) return
        switching = false
        options.phase(null)
        options.settled()
        if (disposed) return
        frame = requestAnimationFrame(() => {
          frame = null
          request()
        })
      }, 280)
    }, 200)
  }

  return {
    request,
    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      if (frame !== null) cancelAnimationFrame(frame)
      timer = null
      frame = null
    },
  }
}
