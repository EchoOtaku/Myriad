/** One transport, independently cancellable consumers. */
export class SharedRequest<T> {
  readonly controller = new AbortController()
  readonly promise: Promise<T>
  private consumers = 0
  private settled = false

  constructor(load: (signal: AbortSignal) => Promise<T>) {
    this.promise = Promise.try(() => load(this.controller.signal)).finally(() => {
      this.settled = true
    })
  }

  wait(signal?: AbortSignal): Promise<T> {
    this.consumers++
    return new Promise<T>((resolve, reject) => {
      let done = false
      const release = () => {
        done = true
        signal?.removeEventListener('abort', abort)
        this.consumers--
        // Allow same-turn handoffs (including StrictMode remounts) to reuse IO.
        if (!this.settled && this.consumers === 0) {
          queueMicrotask(() => {
            if (!this.settled && this.consumers === 0) this.controller.abort()
          })
        }
      }
      const abort = () => {
        if (done) return
        release()
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      this.promise.then(value => {
        if (done) return
        release()
        resolve(value)
      }, error => {
        if (done) return
        release()
        reject(error)
      })
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }
}
