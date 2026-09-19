import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  IDLE_TIMEOUT_BATCH,
  runIdleSlice,
  runTaskSlice,
  TASK_FLUSH_BATCH,
} from './idleSlice'

describe('runIdleSlice', () => {
  it('does not drain the queue when requestIdleCallback times out', () => {
    const queue = [1, 2, 3, 4, 5]
    const ran: number[] = []
    runIdleSlice(
      queue,
      { didTimeout: true, timeRemaining: () => 0 },
      (item) => ran.push(item),
    )
    assert.deepEqual(ran, [1])
    assert.equal(ran.length, IDLE_TIMEOUT_BATCH)
    assert.deepEqual(queue, [2, 3, 4, 5])
  })

  it('keeps taking work while the idle deadline has budget', () => {
    const queue = [1, 2, 3]
    const ran: number[] = []
    let remaining = 12
    runIdleSlice(
      queue,
      {
        didTimeout: false,
        timeRemaining: () => remaining,
      },
      (item) => {
        ran.push(item)
        remaining -= 5
      },
      2,
    )
    assert.deepEqual(ran, [1, 2])
    assert.deepEqual(queue, [3])
  })

  it('stops before a task when the remaining budget is already spent', () => {
    const queue = [1, 2]
    const ran: number[] = []
    runIdleSlice(
      queue,
      { didTimeout: false, timeRemaining: () => 2 },
      (item) => ran.push(item),
      2,
    )
    assert.deepEqual(ran, [])
    assert.deepEqual(queue, [1, 2])
  })
})

describe('runTaskSlice', () => {
  it('yields costly work before draining a count-limited batch', () => {
    let time = 0
    const queue = [1, 2, 3, 4, 5]
    const ran: number[] = []
    runTaskSlice(queue, item => { ran.push(item); time += 3 }, () => time)
    assert.deepEqual(ran, [1, 2])
    assert.deepEqual(queue, [3, 4, 5])
  })

  it('keeps a count bound even when callbacks are cheap', () => {
    const queue = Array.from({ length: 100 }, (_, index) => index)
    runTaskSlice(queue, () => {}, () => 0)
    assert.equal(queue.length, 100 - TASK_FLUSH_BATCH)
  })

  it('does not pull recursively scheduled work into the same slice', () => {
    const queue = [1]
    runTaskSlice(queue, item => queue.push(item + 1), () => 0)
    assert.deepEqual(queue, [2])
  })

  it('makes progress when one callback alone exceeds the budget', () => {
    let time = 0
    const queue = [1, 2]
    runTaskSlice(queue, () => { time += 20 }, () => time)
    assert.deepEqual(queue, [2])
  })
})
