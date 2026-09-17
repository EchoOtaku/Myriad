import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, it } from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PreviewSampleImage } from './PreviewSampleImage'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div>')
const prior = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value })
}
after(() => {
  dom.window.close()
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

it('replaces failed thumbnails with a local placeholder and retries only when the source changes', async () => {
  const container = document.getElementById('root')!
  const root = createRoot(container)
  const src = 'https://opengraph.githubassets.com/1/owner/repo'
  try {
    await act(async () => root.render(createElement(PreviewSampleImage, { src })))
    assert.equal(container.querySelector('img')?.getAttribute('loading'), 'lazy')
    await act(async () => container.querySelector('img')!.dispatchEvent(new dom.window.Event('error')))
    assert.equal(container.querySelector('img'), null)
    assert.ok(container.querySelector('.is-placeholder'))
    await act(async () => root.render(createElement(PreviewSampleImage, { src })))
    assert.equal(container.querySelector('img'), null)
    await act(async () => root.render(createElement(PreviewSampleImage, { src: `${src}-new` })))
    assert.equal(container.querySelector('img')?.getAttribute('src'), `${src}-new`)
    await act(async () => root.render(createElement(PreviewSampleImage, { src: null })))
    assert.equal(container.querySelector('img'), null)
    assert.ok(container.querySelector('.is-placeholder'))
  } finally {
    await act(async () => root.unmount())
  }
})
