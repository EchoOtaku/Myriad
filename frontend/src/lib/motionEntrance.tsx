import type { ReactNode } from 'react'
import { createContext, useContext, useLayoutEffect, useState } from 'react'

export type EntrancePhase = 'waiting' | 'running' | 'complete' | 'disabled'
type InitialPolicy = 'inherit' | 'hold' | 'suppress'

const EntrancePhaseContext = createContext<EntrancePhase>('complete')
const InitialPolicyContext = createContext<InitialPolicy>('inherit')

/** The host controls admission; ordinary contents travel with its outer motion. */
export function MotionEntranceHost({
  phase,
  children,
}: {
  phase: EntrancePhase
  children: ReactNode
}) {
  return (
    <EntrancePhaseContext.Provider value={phase}>
      <InitialPolicyContext.Provider
        value={phase === 'complete' ? 'inherit' : 'suppress'}
      >
        {children}
      </InitialPolicyContext.Provider>
    </EntrancePhaseContext.Provider>
  )
}

/**
 * Opt into authored inner motion after both host admission and content mount.
 * A lazy child may arrive after the host starts. Commit its initial pose first,
 * including under a route AnimatePresence with initial=false. The release is
 * one-shot: later data/locale updates retain their normal transition behavior.
 */
export function MotionEntrance({
  enabled = true,
  children,
}: {
  enabled?: boolean
  children: ReactNode
}) {
  const phase = useContext(EntrancePhaseContext)
  const disabled = !enabled || phase === 'disabled'
  const [started, setStarted] = useState(disabled)

  useLayoutEffect(() => {
    // Showing content without motion consumes its entrance too.
    if (disabled) {
      setStarted(true)
      return
    }
    if (started || phase === 'waiting') return
    const frame = requestAnimationFrame(() => setStarted(true))
    return () => cancelAnimationFrame(frame)
  }, [disabled, phase, started])

  const policy: InitialPolicy = disabled
    ? 'suppress'
    : started
      ? 'inherit'
      : 'hold'
  return (
    <InitialPolicyContext.Provider value={policy}>
      {children}
    </InitialPolicyContext.Provider>
  )
}

/** Adapter policy only: motionShim remains independent of widget types. */
export function useMotionInitialPolicy(): InitialPolicy {
  return useContext(InitialPolicyContext)
}
