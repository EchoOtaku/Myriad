/** Cancel one wait without cancelling the shared operation behind it. */
export function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      run()
    }
    const abort = () => finish(() => reject(signal.reason))
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
