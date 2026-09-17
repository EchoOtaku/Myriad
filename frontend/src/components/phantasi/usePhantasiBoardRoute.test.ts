import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { makeSource } from './logic/fixtures'
import { usePhantasiBoardRoute } from './usePhantasiBoardRoute'

it('website cards stay on the board and reader return retains the selected source', async () => {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
  const prior = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const visits: string[] = []
  const navigate = (path: string) => { visits.push(path) }
  const visible = ['feeds', 'notes', 'sites']
  const entry = { journalSourceId: 9 }
  let route!: ReturnType<typeof usePhantasiBoardRoute>
  function Harness({ path = '/journal', state = entry }: { path?: string; state?: unknown }) {
    const [active, setActive] = useState('feeds')
    route = usePhantasiBoardRoute(false, false, visible, active, setActive, path, navigate, state)
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(Harness)))
    assert.equal(route.railFocusId, 9)
    await act(async () => route.focusSource(makeSource({ id: 12 })))
    assert.equal(route.railFocusId, 12)
    assert.equal(route.listPath, '/journal')
    assert.deepEqual(visits, [])
    await act(async () => root.render(createElement(Harness, { path: '/journal/articles/7', state: null })))
    await act(async () => root.render(createElement(Harness)))
    assert.equal(route.railFocusId, 12)
    await act(async () => route.focusSource(null))
    assert.equal(route.railFocusId, null)
    assert.deepEqual(visits, [])
    await act(async () => root.render(createElement(Harness, { state: { journalSourceId: 21 } })))
    assert.equal(route.railFocusId, 21)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
