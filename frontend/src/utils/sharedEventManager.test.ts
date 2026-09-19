import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { SharedEventManager } from './sharedEventManager.ts'

describe('shared event delivery ownership', () => {
  let frames: Map<number, FrameRequestCallback>
  let target: EventTarget
  let manager: SharedEventManager
  let requestDescriptor: PropertyDescriptor | undefined
  let cancelDescriptor: PropertyDescriptor | undefined
  beforeEach(() => {
    frames = new Map()
    let id = 0
    requestDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
    cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => {
      frames.set(++id, callback)
      return id
    } })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => frames.delete(id) })
    target = new EventTarget()
    manager = new SharedEventManager(() => target)
  })
  afterEach(() => {
    manager.clear()
    if (requestDescriptor) Object.defineProperty(globalThis, 'requestAnimationFrame', requestDescriptor)
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    if (cancelDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelDescriptor)
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  })
  function flush() {
    const batch = [...frames.values()]
    frames.clear()
    for (const callback of batch) callback(16)
  }

  for (const throttledFirst of [true, false]) {
    it(`subscriber timing is independent of order (throttled first: ${throttledFirst})`, () => {
      const immediate: Event[] = []
      const deferred: Event[] = []
      const registrations = [
        () => manager.add('resize', event => immediate.push(event)),
        () => manager.add('resize', event => deferred.push(event), { throttle: true }),
      ]
      if (throttledFirst) registrations.reverse()
      registrations.forEach(register => register())
      const events = [new Event('resize'), new Event('resize'), new Event('resize')]
      events.forEach(event => target.dispatchEvent(event))
      assert.deepEqual(immediate, events)
      assert.deepEqual(deferred, [])
      assert.equal(frames.size, 1)
      flush()
      assert.deepEqual(deferred, [events[2]])
    })
  }

  it('a removed subscriber and a new subscriber do not receive a queued old event', () => {
    const calls: string[] = []
    const off = manager.add('scroll', () => calls.push('removed'), { throttle: true })
    manager.add('scroll', () => calls.push('retained'), { throttle: true })
    target.dispatchEvent(new Event('scroll'))
    off()
    manager.add('scroll', () => calls.push('new'), { throttle: true })
    flush()
    assert.deepEqual(calls, ['retained'])
  })

  it('priority delivery respects unsubscription during a dispatch', () => {
    const calls: string[] = []
    const off = manager.add('resize', () => calls.push('low'))
    manager.add('resize', () => { calls.push('high'); off() }, { priority: 10 })
    target.dispatchEvent(new Event('resize'))
    assert.deepEqual(calls, ['high'])
  })

  it('events scheduled during frame delivery get their own next frame', () => {
    let calls = 0
    manager.add('scroll', () => {
      calls++
      if (calls === 1) target.dispatchEvent(new Event('scroll'))
    }, { throttle: true })
    target.dispatchEvent(new Event('scroll'))
    flush()
    assert.equal(calls, 1)
    assert.equal(frames.size, 1)
    flush()
    assert.equal(calls, 2)
  })

  it('last unsubscription cancels queued work and an old disposer cannot remove a replacement channel', () => {
    let calls = 0
    const off = manager.add('scroll', () => calls++, { throttle: true })
    target.dispatchEvent(new Event('scroll'))
    off()
    assert.equal(frames.size, 0)
    assert.deepEqual(manager.getStats(), {})
    manager.add('scroll', () => calls++)
    off()
    target.dispatchEvent(new Event('scroll'))
    assert.equal(calls, 1)
  })
})
