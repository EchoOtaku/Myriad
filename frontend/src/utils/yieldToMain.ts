export const MAIN_SLICE_MS = 8

export function yieldToMain(): Promise<void> {
  const scheduler = (
    globalThis as { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        channel.port2.close()
        resolve()
      }
      channel.port2.postMessage(null)
      return
    }
    setTimeout(resolve, 0)
  })
}

export async function yieldIfSliceExceeded(sliceStart: {
  ms: number
}): Promise<void> {
  if (performance.now() - sliceStart.ms < MAIN_SLICE_MS) return
  await yieldToMain()
  sliceStart.ms = performance.now()
}

export function runWhenIdle(task: () => void, timeout = 2000): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(task, { timeout })
    return
  }
  setTimeout(task, 0)
}
