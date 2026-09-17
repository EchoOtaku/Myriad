export enum LoadPriority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
  IDLE = 4,
}

interface LoadTask {
  id: string
  priority: LoadPriority
  loader: (signal: AbortSignal) => Promise<void>
  timeout?: number
  retryCount?: number
}

interface LoaderConfig {
  maxConcurrent: number
  idleDelay: number // ms
  lowPriorityDelay: number // ms
  mediumPriorityDelay: number // ms
}

/** Cap completed-id set (LRU). */
const MAX_COMPLETED_LOADS = 200
/** Cap failure counts. */
const MAX_FAILED_LOADS = 50

class ResourceLoader {
  private queue: Array<LoadTask & { readyAt: number }> = []
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private running = new Map<string, { task: LoadTask; controller: AbortController }>()
  private activeLoads: Set<string> = new Set()
  /** Map insertion order = LRU. */
  private completedLoads: Map<string, number> = new Map()
  private failedLoads: Map<string, number> = new Map()
  private config: LoaderConfig
  private isPageLoaded = false
  private scheduledIdleTasks = new Map<
    string,
    { kind: 'idle' | 'timeout'; id: number }
  >()

  constructor(config?: Partial<LoaderConfig>) {
    this.config = {
      maxConcurrent: 3,
      idleDelay: 2000,
      lowPriorityDelay: 1000,
      mediumPriorityDelay: 500,
      ...config,
    }

    if (document.readyState === 'complete') {
      this.isPageLoaded = true
    } else {
      window.addEventListener(
        'load',
        () => {
          this.isPageLoaded = true
          this.processQueue()
        },
        { once: true },
      )
    }
  }

  private markCompleted(id: string): void {
    this.completedLoads.delete(id)
    this.completedLoads.set(id, Date.now())
    while (this.completedLoads.size > MAX_COMPLETED_LOADS) {
      const oldest = this.completedLoads.keys().next().value
      if (oldest === undefined) break
      this.completedLoads.delete(oldest)
    }
  }

  private isCompleted(id: string): boolean {
    return this.completedLoads.has(id)
  }

  addTask(task: LoadTask): void {
    if (this.isCompleted(task.id) || this.activeLoads.has(task.id)) {
      return
    }

    const existingIndex = this.queue.findIndex((t) => t.id === task.id)
    if (existingIndex !== -1) {
      if (task.priority < this.queue[existingIndex].priority) {
        this.queue[existingIndex] = { ...task, readyAt: Date.now() + this.getDelayForPriority(task.priority) }
        this.sortQueue()
        this.processQueue()
      }
      return
    }

    this.queue.push({ ...task, readyAt: Date.now() + this.getDelayForPriority(task.priority) })
    this.sortQueue()
    this.processQueue()
  }

  addTasks(tasks: LoadTask[]): void {
    tasks.forEach((task) => this.addTask(task))
  }

  cancelTask(id: string): void {
    const index = this.queue.findIndex((t) => t.id === id)
    if (index !== -1) {
      this.queue = this.queue.toSpliced(index, 1)
    }
    this.cancelScheduledIdleTask(id)
    this.running.get(id)?.controller.abort()
    this.processQueue()
  }

  clearPriority(priority: LoadPriority): void {
    for (const task of this.queue.filter((t) => t.priority === priority)) this.cancelTask(task.id)
    for (const { task } of this.running.values()) {
      if (task.priority === priority) this.cancelTask(task.id)
    }
    if (priority === LoadPriority.IDLE) {
      for (const id of this.scheduledIdleTasks.keys()) this.cancelScheduledIdleTask(id)
    }
  }

  private sortQueue(): void {
    this.queue = this.queue.toSorted((a, b) => a.priority - b.priority)
  }

  private processQueue(): void {
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
    while (this.activeLoads.size < this.config.maxConcurrent) {
      const now = Date.now()
      const index = this.queue.findIndex((task) => task.readyAt <= now)
      if (index === -1) break
      const [task] = this.queue.splice(index, 1)
      void this.executeTask(task)
    }
    if (this.queue.length && this.activeLoads.size < this.config.maxConcurrent) {
      const next = Math.min(...this.queue.map((task) => task.readyAt))
      this.wakeTimer = setTimeout(() => this.processQueue(), Math.max(0, next - Date.now()))
    }
  }

  private getDelayForPriority(priority: LoadPriority): number {
    if (priority === LoadPriority.CRITICAL || priority === LoadPriority.HIGH) {
      return 0
    }

    if (priority === LoadPriority.MEDIUM) {
      return this.isPageLoaded ? 0 : this.config.mediumPriorityDelay
    }

    if (priority === LoadPriority.LOW) {
      return this.isPageLoaded
        ? this.config.lowPriorityDelay
        : this.config.lowPriorityDelay * 2
    }

    if (priority === LoadPriority.IDLE) {
      return this.isPageLoaded
        ? this.config.idleDelay
        : this.config.idleDelay * 2
    }

    return 0
  }

  private async executeTask(task: LoadTask): Promise<void> {
    this.activeLoads.add(task.id)
    const controller = new AbortController()
    this.running.set(task.id, { task, controller })
    const timeoutId = task.timeout
      ? setTimeout(() => controller.abort(new Error('Task timeout')), task.timeout)
      : null

    try {
      // Keep the slot until the operation settles, even when a loader ignores abort.
      await task.loader(controller.signal)
      if (controller.signal.aborted) return
      this.markCompleted(task.id)
      this.failedLoads.delete(task.id)
    } catch (error) {
      if (controller.signal.aborted) return
      console.warn(`Resource load failed for task ${task.id}:`, error)

      const failCount = (this.failedLoads.get(task.id) || 0) + 1
      this.failedLoads.delete(task.id)
      this.failedLoads.set(task.id, failCount)
      while (this.failedLoads.size > MAX_FAILED_LOADS) {
        const oldest = this.failedLoads.keys().next().value
        if (oldest === undefined) break
        this.failedLoads.delete(oldest)
      }

      if (task.retryCount && failCount < task.retryCount) {
        this.queue.push({
          ...task,
          readyAt: Date.now() + this.getDelayForPriority(LoadPriority.IDLE),
          priority: Math.min(
            task.priority + 1,
            LoadPriority.IDLE,
          ) as LoadPriority,
        })
        this.sortQueue()
      }
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      this.running.delete(task.id)
      this.activeLoads.delete(task.id)
      this.processQueue()
    }
  }

  scheduleIdleTask(id: string, loader: (signal: AbortSignal) => Promise<void>): void {
    if (
      this.scheduledIdleTasks.has(id) ||
      this.isCompleted(id) ||
      this.activeLoads.has(id) ||
      this.queue.some((task) => task.id === id)
    ) {
      return
    }

    if (typeof window.requestIdleCallback !== 'undefined') {
      const callbackId = window.requestIdleCallback(() => {
        this.scheduledIdleTasks.delete(id)
        this.addTask({
          id,
          priority: LoadPriority.IDLE,
          loader,
        })
      })
      this.scheduledIdleTasks.set(id, { kind: 'idle', id: callbackId })
    } else {
      const timeoutId = window.setTimeout(() => {
        this.scheduledIdleTasks.delete(id)
        this.addTask({
          id,
          priority: LoadPriority.IDLE,
          loader,
        })
      }, this.config.idleDelay)
      this.scheduledIdleTasks.set(id, { kind: 'timeout', id: timeoutId })
    }
  }

  private cancelScheduledIdleTask(id: string): void {
    const scheduled = this.scheduledIdleTasks.get(id)
    if (!scheduled) return

    if (scheduled.kind === 'idle') {
      window.cancelIdleCallback(scheduled.id)
    } else {
      window.clearTimeout(scheduled.id)
    }
    this.scheduledIdleTasks.delete(id)
  }

  async waitForCritical(): Promise<void> {
    while (
      this.queue.some((t) => t.priority <= LoadPriority.HIGH) ||
      Array.from(this.running.values()).some(({ task }) => task.priority <= LoadPriority.HIGH)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  getStats() {
    const queuedByPriority = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      idle: 0,
    }

    for (const task of this.queue) {
      switch (task.priority) {
        case LoadPriority.CRITICAL:
          queuedByPriority.critical++
          break
        case LoadPriority.HIGH:
          queuedByPriority.high++
          break
        case LoadPriority.MEDIUM:
          queuedByPriority.medium++
          break
        case LoadPriority.LOW:
          queuedByPriority.low++
          break
        case LoadPriority.IDLE:
          queuedByPriority.idle++
          break
      }
    }

    return {
      queued: this.queue.length,
      active: this.activeLoads.size,
      completed: this.completedLoads.size,
      failed: this.failedLoads.size,
      queuedByPriority,
    }
  }

  clear(): void {
    this.queue = []
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
    for (const { controller } of this.running.values()) controller.abort()
    for (const id of Iterator.from(this.scheduledIdleTasks.keys()).toArray()) {
      this.cancelScheduledIdleTask(id)
    }
  }

  reset(): void {
    this.clear()
    this.completedLoads.clear()
    this.failedLoads.clear()
  }
}

export const globalResourceLoader = new ResourceLoader({
  maxConcurrent: 3,
  idleDelay: 2000,
  lowPriorityDelay: 1500,
  mediumPriorityDelay: 800,
})

// No idle timer in dev tools.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__resourceLoader = globalResourceLoader
}

export const loadResource = {
  critical: (id: string, loader: (signal: AbortSignal) => Promise<void>) => {
    globalResourceLoader.addTask({
      id,
      priority: LoadPriority.CRITICAL,
      loader,
    })
  },

  high: (id: string, loader: (signal: AbortSignal) => Promise<void>) => {
    globalResourceLoader.addTask({ id, priority: LoadPriority.HIGH, loader })
  },

  medium: (id: string, loader: (signal: AbortSignal) => Promise<void>) => {
    globalResourceLoader.addTask({ id, priority: LoadPriority.MEDIUM, loader })
  },

  low: (id: string, loader: (signal: AbortSignal) => Promise<void>) => {
    globalResourceLoader.addTask({
      id,
      priority: LoadPriority.LOW,
      loader,
      retryCount: 2,
    })
  },

  idle: (id: string, loader: (signal: AbortSignal) => Promise<void>) => {
    globalResourceLoader.scheduleIdleTask(id, loader)
  },
}
