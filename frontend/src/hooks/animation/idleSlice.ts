export interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

/** 超时只表示「必须开工」，不是把队列一次倒完。 */
export const IDLE_TIMEOUT_BATCH = 1

/** MessageChannel 回调每片最多这么多，避开 Long Task。 */
export const TASK_FLUSH_BATCH = 8

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
