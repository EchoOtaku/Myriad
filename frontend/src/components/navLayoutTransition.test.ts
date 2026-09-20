import type { TestContext } from 'node:test'
import type { NavLayout } from '../utils/navLayout'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createNavLayoutTransition } from './navLayoutTransition'

function harness(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const prior = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  let current: NavLayout = 'desktop'
  let desired: NavLayout = 'mobile'
  const events: string[] = []
  const transition = createNavLayoutTransition({
    current: () => current,
    desired: () => desired,
    phase: phase => events.push(phase ?? 'idle'),
    commit: layout => { current = layout; events.push(layout) },
    settled: () => { events.push('settled') },
  })
  t.after(() => {
    transition.dispose()
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return {
    ...transition, events, frames,
    desired(layout: NavLayout) { desired = layout },
    flush() {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(0))
    },
  }
}

it('commits only at the hidden phase and preserves fade durations', t => {
  const h = harness(t)
  h.request()
  h.request()
  t.mock.timers.tick(199)
  assert.deepEqual(h.events, ['out'])
  t.mock.timers.tick(1)
  assert.deepEqual(h.events, ['out', 'mobile', 'in'])
  t.mock.timers.tick(279)
  assert.equal(h.events.at(-1), 'in')
  t.mock.timers.tick(1)
  assert.deepEqual(h.events, ['out', 'mobile', 'in', 'idle', 'settled'])
  h.flush()
  assert.equal(h.events.length, 5)
})

it('reads the latest destination at commit and follows changes during fade-in', t => {
  const h = harness(t)
  h.request()
  h.desired('desktop')
  t.mock.timers.tick(200)
  assert.deepEqual(h.events, ['out', 'desktop', 'in'])
  h.desired('mobile')
  h.request()
  assert.equal(h.events.length, 3)
  t.mock.timers.tick(280)
  h.flush()
  assert.equal(h.events.at(-1), 'out')
  t.mock.timers.tick(200)
  assert.deepEqual(h.events.slice(-2), ['mobile', 'in'])
})

for (const elapsed of [0, 200, 480]) {
  it(`disposes pending work at ${elapsed} ms without restarting`, t => {
    const h = harness(t)
    h.request()
    if (elapsed >= 200) t.mock.timers.tick(200)
    if (elapsed >= 480) t.mock.timers.tick(280)
    const before = [...h.events]
    h.dispose()
    h.desired('desktop')
    h.request()
    t.mock.timers.tick(1000)
    assert.equal(h.frames.size, 0)
    h.flush()
    assert.deepEqual(h.events, before)
  })
}
