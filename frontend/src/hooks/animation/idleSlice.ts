export interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

/** 超时只表示「必须开工」，不是把队列一次倒完。 */
export const IDLE_TIMEOUT_BATCH = 1

/** Bound both callback count and elapsed work before yielding to rendering. */
export const TASK_FLUSH_BATCH = 8
export const TASK_SLICE_MS = 4

export function runTaskSlice<T>(
  queue: T[],
  run: (item: T) => void,
  now: () => number = () => performance.now(),
): void {
  const deadline = now() + TASK_SLICE_MS
  const count = Math.min(queue.length, TASK_FLUSH_BATCH)
  for (let index = 0; index < count; index++) {
    if (index > 0 && now() >= deadline) break
    const item = queue.shift()
    if (item === undefined) break
    run(item)
  }
}

export function runIdleSlice<T>(
  queue: T[],
  deadline: IdleDeadlineLike,
  run: (item: T) => void,
  minRemainingMs = 2,
): void {
  let ran = 0
  while (queue.length > 0) {
    if (deadline.didTimeout) {
      if (ran >= IDLE_TIMEOUT_BATCH) break
    } else if (deadline.timeRemaining() <= minRemainingMs) {
      break
    }
    const item = queue.shift()
    if (item === undefined) break
    run(item)
    ran += 1
  }
}
