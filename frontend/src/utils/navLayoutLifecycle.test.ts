import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, it } from 'node:test'
import { getNavLayoutSnapshot, subscribeNavLayout } from './navLayout'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('')
const win = dom.window
const queries: Array<{ active: Set<unknown> }> = []
win.matchMedia = () => {
  const active = new Set<unknown>()
  queries.push({ active })
  return { matches: false, addEventListener: (_: string, fn: unknown) => active.add(fn), removeEventListener: (_: string, fn: unknown) => active.delete(fn) }
}
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const prior = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({
  window: win, document: win.document, navigator: win.navigator,
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
  cancelAnimationFrame: (id: number) => frames.delete(id),
})) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value })
}
after(() => {
  win.close()
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
function width(value: number) { win.innerWidth = value }
function subscribedQueries() { return queries.filter(query => query.active.size > 0).length }
function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(callback => callback(0))
}

it('snapshot reads do not subscribe or write the chrome layout', () => {
  width(390)
  document.documentElement.dataset.navLayout = 'desktop'
  assert.equal(getNavLayoutSnapshot(), 'mobile')
  assert.equal(subscribedQueries(), 0)
  assert.equal(document.documentElement.dataset.navLayout, 'desktop')
  width(1440)
  assert.equal(getNavLayoutSnapshot(), 'desktop')
})

it('shares observation, coalesces orientation work and releases it with the last owner', () => {
  width(1440)
  let first = 0
  let second = 0
  const stopFirst = subscribeNavLayout(() => first++)
  const stopSecond = subscribeNavLayout(() => second++)
  try {
    assert.equal(subscribedQueries(), 2)
    width(390)
    win.dispatchEvent(new win.Event('orientationchange'))
    win.dispatchEvent(new win.Event('orientationchange'))
    assert.equal(frames.size, 1)
    flushFrames()
    assert.equal(getNavLayoutSnapshot(), 'mobile')
    assert.equal(first, 1)
    assert.equal(second, 1)
    stopFirst()
    assert.equal(subscribedQueries(), 2)
    width(1440)
    win.dispatchEvent(new win.Event('orientationchange'))
    stopSecond()
    assert.equal(frames.size, 0)
    assert.equal(subscribedQueries(), 0)
    win.dispatchEvent(new win.Event('orientationchange'))
    assert.equal(frames.size, 0)
    assert.equal(getNavLayoutSnapshot(), 'desktop')
  } finally { stopFirst(); stopSecond() }
})

it('cancels pending resize work and starts a fresh subscription from current geometry', async () => {
  width(1440)
  let changes = 0
  const stop = subscribeNavLayout(() => changes++)
  width(390)
  win.dispatchEvent(new win.Event('resize'))
  stop()
  const restart = subscribeNavLayout(() => changes++)
  try {
    assert.equal(getNavLayoutSnapshot(), 'mobile')
    await new Promise(resolve => setTimeout(resolve, 70))
    assert.equal(changes, 0)
    width(1440)
    win.dispatchEvent(new win.Event('resize'))
    await new Promise(resolve => setTimeout(resolve, 70))
    assert.equal(getNavLayoutSnapshot(), 'desktop')
    assert.equal(changes, 1)
  } finally { restart() }
})
