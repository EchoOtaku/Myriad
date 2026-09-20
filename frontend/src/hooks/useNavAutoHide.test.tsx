import type { Root } from 'react-dom/client'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, beforeEach, it } from 'node:test'
import { act, createElement } from 'react'
import { setTourDomActive } from '../components/tour/tourDom'
import { NAV_CHROME_SETTLED_EVENT } from '../utils/navLayout'
import { useNavAutoHide } from './useNavAutoHide'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div><nav class="nav-container"></nav>')
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const prior = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  AbortController: dom.window.AbortController,
  Event: dom.window.Event,
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
  cancelAnimationFrame: (id: number) => frames.delete(id),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value })
}
const { createRoot } = await import('react-dom/client')
after(() => {
  dom.window.close()
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
let root: Root
const nav = document.querySelector<HTMLElement>('nav')!
function Harness() { useNavAutoHide(); return null }
function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(0)
}
function settle() { nav.dispatchEvent(new Event(NAV_CHROME_SETTLED_EVENT)) }
beforeEach(async () => {
  nav.removeAttribute('style')
  nav.removeAttribute('data-nav-switch')
  setTourDomActive(false)
  frames.clear()
  root = createRoot(document.getElementById('root')!)
  await act(async () => root.render(createElement(Harness)))
})
afterEach(async () => { await act(async () => root.unmount()); frames.clear() })

it('does not restore an old transition after its owner unmounts', async () => {
  settle()
  await act(async () => root.render(null))
  nav.style.transition = 'none'
  flushFrames()
  assert.equal(nav.style.transition, 'none')
})
it('keeps an intervening tour in its immediate pose until the tour ends', () => {
  settle()
  setTourDomActive(true)
  assert.equal(nav.style.transition, 'none')
  flushFrames()
  assert.equal(nav.style.transition, 'none')
  setTourDomActive(false)
  assert.equal(nav.style.transition, 'opacity 0.3s ease, transform 0.3s ease')
})
it('coalesces repeated layout settlements and restores the unchanged transition', () => {
  settle()
  settle()
  assert.equal(nav.style.transition, 'opacity 0.3s ease')
  assert.equal(frames.size, 1)
  flushFrames()
  assert.equal(nav.style.transition, 'opacity 0.3s ease, transform 0.3s ease')
})
it('does not overwrite a new layout crossfade in the pending frame', () => {
  settle()
  nav.dataset.navSwitch = 'out'
  nav.style.transition = 'opacity 0.2s linear'
  flushFrames()
  assert.equal(nav.style.transition, 'opacity 0.2s linear')
})
