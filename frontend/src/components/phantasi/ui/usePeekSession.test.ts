import type { Root } from 'react-dom/client'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, beforeEach, it } from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { articlePrefetchGeneration } from '../articlePrefetch'
import { notePeekPointer } from './peekLane'
import { readPeekFace } from './PhantasiPeekAir'
import { usePeekSession } from './usePeekSession'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div><div data-phantasi-peek-lane><button class="phantasi-story" data-rail-id="1"><span class="phantasi-story__title">One</span></button></div>', { url: 'https://test.invalid', pretendToBeVisual: true })
const prior = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node, localStorage: dom.window.localStorage, MessageChannel: undefined, IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value })
}
dom.window.document.elementFromPoint = () => null
let root: Root
let session: ReturnType<typeof usePeekSession>
function Harness({ path = '/journal', blocked = false }) {
  session = usePeekSession(path, blocked)
  return null
}
beforeEach(async () => {
  root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => root.render(createElement(Harness)))
})
afterEach(async () => { await act(async () => root.unmount()) })
after(() => {
  dom.window.close()
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
function enter() {
  dom.window.document.querySelector('button')!.classList.add('is-peek')
  session.handlePeekItem({ id: 1, title: 'One', image: 'https://test.invalid/cover.jpg' })
  assert.ok(readPeekFace())
}
function cleared() {
  assert.equal(readPeekFace(), null)
  assert.equal(dom.window.document.querySelector('.is-peek'), null)
}
it('route change clears the old session and new cards can start immediately', async () => {
  enter()
  const generation = articlePrefetchGeneration()
  await act(async () => root.render(createElement(Harness, { path: '/journal/notes' })))
  cleared()
  assert.ok(articlePrefetchGeneration() > generation)
  enter()
})
it('opening a reader blocks callbacks retained by the outgoing tree', async () => {
  enter()
  await act(async () => root.render(createElement(Harness, { blocked: true })))
  session.handlePeekItem({ id: 2, title: 'Stale', image: '/stale.jpg' })
  cleared()
})
for (const event of ['blur', 'pagehide']) {
  it(`${event} clears all session resources`, () => {
    enter()
    const generation = articlePrefetchGeneration()
    dom.window.dispatchEvent(new dom.window.Event(event))
    cleared()
    assert.ok(articlePrefetchGeneration() > generation)
  })
}
it('pointer cancellation and leaving the window clear the session', () => {
  for (const event of ['pointercancel', 'pointerleave']) {
    enter()
    dom.window.document.documentElement.dispatchEvent(new dom.window.Event(event, { bubbles: true }))
    cleared()
  }
})
it('unmount cancels a pending resume and rejects stale callbacks', async () => {
  enter()
  notePeekPointer({ clientX: 10, clientY: 10 })
  session.resumePeekAfterLane()
  const stale = session.handlePeekItem
  await act(async () => root.render(null))
  stale({ id: 1, title: 'Late', image: '/late.jpg' })
  cleared()
})

it('hidden tabs end the session and a stale end callback cannot clear a remount', async () => {
  enter()
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' })
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'))
  cleared()
  Reflect.deleteProperty(dom.window.document, 'visibilityState')
  const oldEnd = session.handlePeekEnd
  await act(async () => root.render(null))
  await act(async () => root.render(createElement(Harness)))
  enter()
  oldEnd()
  assert.ok(readPeekFace())
})
