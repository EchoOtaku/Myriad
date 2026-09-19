import assert from 'node:assert/strict'
import test from 'node:test'
import { SharedMediaQueryStore } from './sharedMediaQuery'

function fixture() {
  let matches = false
  const listeners = new Set<() => void>()
  let sources = 0
  const store = new SharedMediaQueryStore(() => {
    sources++
    return {
      get matches() { return matches },
      addEventListener: (_type: string, callback: () => void) => { listeners.add(callback) },
      removeEventListener: (_type: string, callback: () => void) => { listeners.delete(callback) },
    } as Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>
  })
  return { store, listeners, sources: () => sources, set(value: boolean) { matches = value }, change() { for (const callback of [...listeners]) callback() } }
}

test('snapshot reads install no listeners; subscribers share one source and release it', () => {
  const f = fixture()
  assert.equal(f.store.read('phone'), false)
  assert.equal(f.listeners.size, 0)
  let notifications = 0
  const listener = () => { notifications++ }
  const offA = f.store.subscribe('phone', listener)
  const offB = f.store.subscribe('phone', listener)
  assert.equal(f.listeners.size, 1)
  const sources = f.sources()
  f.set(true)
  // Read native state even before its queued change event is delivered.
  assert.equal(f.store.read('phone'), true)
  assert.equal(f.sources(), sources)
  f.change()
  assert.equal(notifications, 2)
  offA()
  offA()
  assert.equal(f.listeners.size, 1)
  f.change()
  assert.equal(notifications, 3)
  offB()
  assert.equal(f.listeners.size, 0)
  f.set(false)
  assert.equal(f.store.read('phone'), false)
  const offC = f.store.subscribe('phone', listener)
  offB() // An old disposer must not remove a remounted subscription.
  assert.equal(f.listeners.size, 1)
  offC()
  assert.equal(f.listeners.size, 0)
})

test('distinct queries own their listeners independently', () => {
  const f = fixture()
  const a = f.store.subscribe('phone', () => {})
  const b = f.store.subscribe('desktop', () => {})
  assert.equal(f.listeners.size, 2)
  a()
  assert.equal(f.listeners.size, 1)
  b()
  assert.equal(f.listeners.size, 0)
})

test('unavailable media queries have a stable false snapshot and inert cleanup', () => {
  const store = new SharedMediaQueryStore(() => null)
  assert.equal(store.read('phone'), false)
  store.subscribe('phone', () => assert.fail('unexpected event'))()
})
