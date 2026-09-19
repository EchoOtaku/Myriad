import { createFrameResizeObserver } from './frameResizeObserver'
import { runIdleSlice, runTaskSlice } from './idleSlice'
import { Feature, hasFeature } from './pageFeatures'

export type Unsubscribe = () => void

let currentPageId: string | null = null

let visibilityInitialized = false
let messageChannelInitialized = false

let _isPageVisible = true
let _visibilityHandler: (() => void) | null = null
const _visibilitySubscribers = new Set<(visible: boolean) => void>()

function initVisibility() {
  if (visibilityInitialized || typeof document === 'undefined') return

  if (currentPageId && !hasFeature(currentPageId, Feature.Visibility)) {
    if (import.meta.env.DEV) {
      console.warn(`[Core] Visibility not enabled for page: ${currentPageId}`)
    }
  }
  visibilityInitialized = true

  _isPageVisible = !document.hidden
  document.documentElement.toggleAttribute('data-page-hidden', document.hidden)
  _visibilityHandler = () => {
    _isPageVisible = !document.hidden
    document.documentElement.toggleAttribute(
      'data-page-hidden',
      document.hidden,
    )

    if (_isPageVisible) scheduleIdleRun()

    for (const sub of _visibilitySubscribers) {
      try {
        sub(_isPageVisible)
      } catch {}
    }
  }
  document.addEventListener('visibilitychange', _visibilityHandler, {
    passive: true,
  })
}

export function onVisibility(
  callback: (visible: boolean) => void,
): Unsubscribe {
  initVisibility()
  _visibilitySubscribers.add(callback)
  return () => {
    _visibilitySubscribers.delete(callback)
  }
}

export function isPageVisible(): boolean {
  if (!visibilityInitialized) initVisibility()
  return _isPageVisible
}

let _channel: MessageChannel | null = null
let _taskFlushScheduled = false
const _pendingCallbacks: Array<() => void> = []

function initMessageChannel() {
  if (messageChannelInitialized) return
  messageChannelInitialized = true

  if (typeof MessageChannel !== 'undefined') {
    _channel = new MessageChannel()
    _channel.port1.onmessage = () => {
      runTaskSlice(_pendingCallbacks, (callback) => {
        try { callback() } catch (error) { console.error('Scheduled task error:', error) }
      })
      if (_pendingCallbacks.length > 0) _channel?.port2.postMessage(null)
      else _taskFlushScheduled = false
    }
  }
}

/** 比 setTimeout(0) 快（MessageChannel）。 */
export function scheduleTask(callback: () => void): void {
  initMessageChannel()
  if (_channel) {
    _pendingCallbacks.push(callback)
    if (!_taskFlushScheduled) {
      _taskFlushScheduled = true
      _channel.port2.postMessage(null)
    }
  } else {
    setTimeout(callback, 0)
  }
}

/** Scheduling deadlines must use current time, including after idle gaps. */
export function now(): number {
  return performance.now()
}

const frameResize = createFrameResizeObserver({ isVisible: isPageVisible })

export function observeResize(
  element: Element,
  callback: (entry: ResizeObserverEntry) => void,
): Unsubscribe {
  return frameResize.observe(element, callback)
}

interface IdleTask {
  id: string
  task: () => void
  priority: number
  timeout?: number
}

let _idleTasks: IdleTask[] = []
let _idleCallbackId: number | null = null
const _registeredTasks = new Set<string>()

function scheduleIdleRun() {
  if (_idleCallbackId !== null || _idleTasks.length === 0 || !_isPageVisible)
    return

  const run =
    typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (cb: IdleRequestCallback) =>
          setTimeout(
            () => cb({ didTimeout: false, timeRemaining: () => 50 }),
            1,
          )

  _idleCallbackId = run(
    (deadline) => {
      _idleCallbackId = null
      if (!isPageVisible()) return

      runIdleSlice(_idleTasks, deadline, (task) => {
        _registeredTasks.delete(task.id)
        try {
          task.task()
        } catch {}
      })

      if (_idleTasks.length > 0) scheduleIdleRun()
    },
    { timeout: _idleTasks[0]?.timeout ?? 2000 },
  ) as number
}

export function scheduleIdle(
  id: string,
  task: () => void,
  priority: 'low' | 'normal' | 'high' = 'normal',
  options: { timeout?: number, dedupe?: boolean } = {},
): Unsubscribe {
  if (options.dedupe !== false && _registeredTasks.has(id)) {
    return () => cancelIdle(id)
  }

  const p = priority === 'high' ? 2 : priority === 'normal' ? 1 : 0
  _idleTasks.push({ id, task, priority: p, timeout: options.timeout })
  _registeredTasks.add(id)

  for (let i = _idleTasks.length - 1; i > 0; i--) {
    if (_idleTasks[i].priority > _idleTasks[i - 1].priority) {
      ;[_idleTasks[i], _idleTasks[i - 1]] = [_idleTasks[i - 1], _idleTasks[i]]
    } else {
      break
    }
  }

  scheduleIdleRun()
  return () => cancelIdle(id)
}

export function cancelIdle(id: string): boolean {
  const idx = _idleTasks.findIndex((t) => t.id === id)
  if (idx !== -1) {
    _idleTasks = _idleTasks.toSpliced(idx, 1)
    _registeredTasks.delete(id)
    return true
  }
  return false
}

let _reads: Array<() => void> = []
let _writes: Array<() => void> = []
let _domBatchScheduled = false

function flushDomBatch() {
  _domBatchScheduled = false

  // 先读后写，避免强制重排。
  const reads = _reads
  _reads = []
  for (const r of reads) {
    try {
      r()
    } catch {}
  }

  const writes = _writes
  _writes = []
  for (const w of writes) {
    try {
      w()
    } catch {}
  }
}

export function batchRead(callback: () => void): void {
  _reads.push(callback)
  if (!_domBatchScheduled) {
    _domBatchScheduled = true
    requestAnimationFrame(flushDomBatch)
  }
}

export function batchWrite(callback: () => void): void {
  _writes.push(callback)
  if (!_domBatchScheduled) {
    _domBatchScheduled = true
    requestAnimationFrame(flushDomBatch)
  }
}

const _pageCleanupRegistry = new Map<string, () => void>()

export function registerPageCleanup(pageId: string, cleanup: () => void): void {
  _pageCleanupRegistry.set(pageId, cleanup)
}

export function runPageCleanup(pageId: string): void {
  _pageCleanupRegistry.get(pageId)?.()
}

export function startPage(pageId: string): void {
  if (currentPageId === pageId) return

  currentPageId = pageId

  if (hasFeature(pageId, Feature.Visibility) && !visibilityInitialized) {
    initVisibility()
  }
}

// Shared tasks/DOM batches are owned by their callers. Route cleanup only
// releases resources registered for that route via runPageCleanup.
export function resume(): void {
  scheduleIdleRun()
}
