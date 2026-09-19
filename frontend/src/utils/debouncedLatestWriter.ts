interface WriterOptions<T> {
  signal: AbortSignal
  delay: number
  write: (value: T, signal: AbortSignal) => Promise<void>
  onError: (error: unknown, signal: AbortSignal) => Promise<void> | void
}

/** One active write; edits during it replace only the next pending snapshot. */
export class DebouncedLatestWriter<T> {
  private pending: { value: T } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private ready = false

  constructor(private options: WriterOptions<T>) {
    options.signal.addEventListener('abort', () => {
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = null
      this.pending = null
      this.ready = false
    }, { once: true })
  }

  enqueue(value: T): void {
    if (this.options.signal.aborted) return
    this.pending = { value }
    this.ready = false
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.ready = true
      this.pump()
    }, this.options.delay)
  }

  private pump(): void {
    if (this.running || !this.ready || !this.pending || this.options.signal.aborted) return
    const { value } = this.pending
    this.pending = null
    this.ready = false
    this.running = true
    const { signal, write, onError } = this.options
    void Promise.try(() => write(value, signal))
      .catch(async error => {
        if (!signal.aborted) await onError(error, signal)
      })
      .catch(error => {
        if (!signal.aborted) console.error('Failed to report save error:', error)
      })
      .finally(() => {
        this.running = false
        this.pump()
      })
  }
}
