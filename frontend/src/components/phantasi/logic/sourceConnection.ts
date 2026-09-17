interface SourceSocket {
  onclose: ((...args: any[]) => void) | null
  close: () => void
}

/** One live socket and one retry timer; stale generations cannot publish. */
export function connectSourceUpdates(
  create: (message: () => void, error: () => void) => SourceSocket,
  refresh: () => void,
): () => void {
  let disposed = false
  let socket: SourceSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  const schedule = (delay: number) => {
    if (disposed || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; connect() }, delay)
  }
  const connect = () => {
    if (disposed) return
    const turn = ++generation
    const current = () => !disposed && generation === turn
    const disconnected = () => {
      if (!current()) return
      generation++
      const old = socket
      socket = null
      if (old) {
        old.onclose = null
        try { old.close() } catch { /* already disconnected */ }
      }
      schedule(5000)
    }
    try {
      socket = create(() => { if (current()) refresh() }, disconnected)
      socket.onclose = disconnected
    } catch {
      schedule(8000)
    }
  }
  connect()
  return () => {
    disposed = true
    generation++
    clearTimeout(timer)
    if (socket) {
      socket.onclose = null
      try { socket.close() } catch { /* already disconnected */ }
      socket = null
    }
  }
}
