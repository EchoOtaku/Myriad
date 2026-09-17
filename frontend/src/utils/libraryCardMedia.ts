const MAX_CONCURRENT_COVER_DECODES = 8

type Release = () => void

let activeDecodes = 0
const waitQueue: Array<() => void> = []

function pumpQueue() {
  while (waitQueue.length > 0) {
    if (activeDecodes >= MAX_CONCURRENT_COVER_DECODES) {
      return
    }
    const next = waitQueue.shift()
    if (!next) {
      return
    }
    next()
  }
}

export function acquireCoverDecodeSlot(signal?: AbortSignal): Promise<Release> {
  return new Promise((resolve, reject) => {
    let granted = false
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal?.removeEventListener('abort', abort)
      if (granted) activeDecodes = Math.max(0, activeDecodes - 1)
      else {
        const index = waitQueue.indexOf(grant)
        if (index !== -1) waitQueue.splice(index, 1)
      }
      pumpQueue()
    }
    const abort = () => {
      release()
      reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
    }
    const grant = () => {
      granted = true
      activeDecodes += 1
      resolve(release)
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    if (activeDecodes < MAX_CONCURRENT_COVER_DECODES) grant()
    else waitQueue.push(grant)
  })
}

export function __coverDecodeSlotStatsForTest() {
  return { active: activeDecodes, waiting: waitQueue.length }
}

export function releaseCoverImageElement(img: HTMLImageElement | null) {
  if (!img) return
  try {
    img.removeAttribute('src')
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
  } catch {
  }
}

export const LIBRARY_CARD_COVER_SIZES = '(max-width: 767px) 42vw, 220px'
