import { phantasiItemState } from './phantasiItemState'
import { requestCache } from './requestCache'

export interface PhantasiSubjectSnapshot {
  readonly key: string
  readonly active: boolean
  readonly generation: number
  readonly signal: AbortSignal
}

export class PhantasiSubjectScope {
  private controller = new AbortController()
  private listeners = new Set<() => void>()
  private snapshot: PhantasiSubjectSnapshot = {
    key: 'guest',
    active: true,
    generation: 0,
    signal: this.controller.signal,
  }

  constructor(private invalidate: () => void) {}

  getSnapshot = (): PhantasiSubjectSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  change(key: string, active = true, force = false): void {
    if (!force && key === this.snapshot.key && active === this.snapshot.active)
      return
    this.controller.abort()
    this.controller = new AbortController()
    this.invalidate()
    this.snapshot = {
      key,
      active,
      generation: this.snapshot.generation + 1,
      signal: this.controller.signal,
    }
    for (const listener of this.listeners) listener()
  }

  capture(): PhantasiSubjectSnapshot {
    this.assert(this.snapshot)
    return this.snapshot
  }

  assert(snapshot: PhantasiSubjectSnapshot): void {
    if (
      !snapshot.active ||
      snapshot !== this.snapshot ||
      snapshot.signal.aborted
    ) {
      throw new DOMException('Phantasi subject changed', 'AbortError')
    }
  }
}

export const phantasiSubject = new PhantasiSubjectScope(() => {
  requestCache.deleteByPrefix('phantasi:')
  phantasiItemState.clear()
})

export function phantasiSubjectKey(
  user: { id: number; is_admin?: boolean } | null,
): string {
  return user
    ? `user:${user.id}:${user.is_admin ? 'admin' : 'member'}`
    : 'guest'
}
