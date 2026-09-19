export type EventCallback = (event: Event) => void

interface ListenerEntry {
  callback: EventCallback
  priority: number
  throttle: boolean
}

interface EventChannel {
  target: EventTarget
  handler: EventCallback
  entries: Set<ListenerEntry>
  ordered: ListenerEntry[]
  pending: Map<ListenerEntry, Event>
  frame: number | null
}

/** One native listener per event, with delivery timing owned by each subscriber. */
export class SharedEventManager {
  private channels = new Map<string, EventChannel>()

  constructor(private getTarget: () => EventTarget = () => window) {}

  add(
    type: string,
    callback: EventCallback,
    { priority = 0, throttle = false }: { priority?: number, throttle?: boolean } = {},
  ): () => void {
    let channel = this.channels.get(type)
    if (!channel) {
      const created: EventChannel = {
        target: this.getTarget(),
        handler: event => this.dispatch(type, created, event),
        entries: new Set(),
        ordered: [],
        pending: new Map(),
        frame: null,
      }
      channel = created
      this.channels.set(type, channel)
      channel.target.addEventListener(type, channel.handler, { passive: true })
    }
    const entry = { callback, priority, throttle }
    channel.entries.add(entry)
    channel.ordered = [...channel.entries].sort((a, b) => b.priority - a.priority)
    const owned = channel
    return () => {
      owned.entries.delete(entry)
      owned.ordered = owned.ordered.filter(item => item !== entry)
      owned.pending.delete(entry)
      if (owned.pending.size === 0 && owned.frame !== null) {
        cancelAnimationFrame(owned.frame)
        owned.frame = null
      }
      if (owned.entries.size === 0 && this.channels.get(type) === owned) {
        this.remove(type, owned)
      }
    }
  }

  private deliver(type: string, channel: EventChannel, entry: ListenerEntry, event: Event) {
    if (!channel.entries.has(entry)) return
    try {
      entry.callback(event)
    } catch (error) {
      console.error(`Error in ${type} listener:`, error)
    }
  }

  private dispatch(type: string, channel: EventChannel, event: Event) {
    const entries = channel.ordered
    for (const entry of entries) {
      if (!channel.entries.has(entry)) continue
      if (entry.throttle) channel.pending.set(entry, event)
      else this.deliver(type, channel, entry, event)
    }
    if (channel.pending.size === 0 || channel.frame !== null) return
    channel.frame = requestAnimationFrame(() => {
      channel.frame = null
      const batch = [...channel.pending].sort(([a], [b]) => b.priority - a.priority)
      channel.pending.clear()
      for (const [entry, latestEvent] of batch) this.deliver(type, channel, entry, latestEvent)
    })
  }

  private remove(type: string, channel: EventChannel) {
    channel.target.removeEventListener(type, channel.handler)
    if (channel.frame !== null) cancelAnimationFrame(channel.frame)
    channel.entries.clear()
    channel.ordered = []
    channel.pending.clear()
    channel.frame = null
    this.channels.delete(type)
  }

  getStats(): Record<string, number> {
    return Object.fromEntries([...this.channels].map(([type, channel]) => [type, channel.entries.size]))
  }

  clear() {
    for (const [type, channel] of this.channels) this.remove(type, channel)
  }
}

export const sharedEventManager = new SharedEventManager()
