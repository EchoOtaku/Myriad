import type { HomeLayoutMode } from '../../utils/homeLayout'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

type Phase = 'out' | 'commit' | 'in' | null

/** Fade clocks belong to their visible phase; frame handoff work is cancellable. */
export function useHomeLayoutTransition(onCommit: (mode: HomeLayoutMode) => void) {
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [phase, setPhase] = useState<Phase>(null)
  const busy = useRef(false)
  const target = useRef<HomeLayoutMode>('standard')
  const committed = useRef(false)
  const commit = useRef(onCommit)
  useLayoutEffect(() => { commit.current = onCommit }, [onCommit])

  const finish = useCallback(() => {
    busy.current = false
    setPhase(null)
  }, [])
  const transitionTo = useCallback((next: HomeLayoutMode) => {
    if (busy.current) return
    busy.current = true
    committed.current = false
    target.current = next
    setPhase('out')
  }, [])

  useEffect(() => {
    if (phase !== 'out') return
    if (reduce) {
      setPhase('commit')
      return
    }
    const timer = setTimeout(setPhase, 180, 'commit')
    return () => clearTimeout(timer)
  }, [phase, reduce])

  useLayoutEffect(() => {
    if (phase !== 'commit') return
    if (!committed.current) {
      committed.current = true
      commit.current(target.current)
    }
    if (reduce) {
      finish()
      return
    }
    let active = true
    let frame = requestAnimationFrame(() => {
      if (!active) return
      frame = requestAnimationFrame(() => {
        if (active) setPhase('in')
      })
    })
    return () => {
      active = false
      cancelAnimationFrame(frame)
    }
  }, [phase, reduce, finish])

  useEffect(() => {
    if (phase !== 'in') return
    if (reduce) {
      finish()
      return
    }
    const timer = setTimeout(finish, 240)
    return () => clearTimeout(timer)
  }, [phase, reduce, finish])

  return { layoutFade: phase === 'commit' ? 'out' : phase, transitionTo }
}
