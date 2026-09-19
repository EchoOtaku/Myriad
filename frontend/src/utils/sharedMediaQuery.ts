type QuerySource = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>
interface Entry {
  source: QuerySource
  listeners: Set<() => void>
  changed: () => void
}

/** Only subscribed queries retain a native source and change listener. */
export class SharedMediaQueryStore {
  private entries = new Map<string, Entry>()

  constructor(private createSource: (query: string) => QuerySource | null) {}

  read(query: string): boolean {
    return (this.entries.get(query)?.source ?? this.createSource(query))?.matches ?? false
  }

  subscribe(query: string, listener: () => void): () => void {
    let entry = this.entries.get(query)
    if (!entry) {
      const source = this.createSource(query)
      if (!source) return () => {}
      const listeners = new Set<() => void>()
      entry = { source, listeners, changed: () => {
        for (const callback of [...listeners]) callback()
      } }
      this.entries.set(query, entry)
      source.addEventListener('change', entry.changed)
    }
    // Independent ownership even if two consumers pass the same callback.
    const notify = () => listener()
    entry.listeners.add(notify)
    return () => {
      entry.listeners.delete(notify)
      if (entry.listeners.size === 0 && this.entries.get(query) === entry) {
        entry.source.removeEventListener('change', entry.changed)
        this.entries.delete(query)
      }
    }
  }
}
