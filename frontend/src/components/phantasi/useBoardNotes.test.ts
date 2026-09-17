import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { requestCache } from '../../utils/requestCache'
import { useBoardNotes } from './useBoardPage'

const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)

it('notes expose early pages, retain them on failure, and retry the failed page', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://test.invalid',
  })
  const old = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  }
  const original = globalThis.fetch
  const second = Promise.withResolvers<Response>()
  let state!: ReturnType<typeof useBoardNotes>
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls === 2) return second.promise
    return Response.json({
      items: [
        {
          id: calls === 1 ? 2 : 1,
          title: 'note',
          source_id: 55,
          published_at: calls === 1 ? 2 : 1,
        },
      ],
      next_cursor: calls === 1 ? 'next' : null,
    })
  }) as typeof fetch
  function Harness() {
    state = useBoardNotes('notes', [{ id: 55, source_type: 'note' }])
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root'))
  try {
    await act(async () => {
      root.render(createElement(Harness))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    assert.deepEqual(
      state.notes.map((note) => note.id),
      [2],
    )
    assert.equal(state.loading, false)
    assert.equal(calls, 1)
    assert.equal(state.hasMore, true)
    await act(async () => state.loadMore())
    await act(async () => {
      second.reject(new Error('offline'))
    })
    assert.equal(state.failed, true)
    assert.equal(state.loading, false)
    assert.deepEqual(
      state.notes.map((note) => note.id),
      [2],
    )
    await act(async () => {
      state.retry()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    // Allow the cached first page to yield before consuming the next one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    assert.deepEqual(
      state.notes.map((note) => note.id),
      [2, 1],
    )
    assert.equal(state.failed, false)
    assert.equal(state.loading, false)
    assert.equal(calls, 3)
  } finally {
    second.resolve(Response.json({ items: [], next_cursor: null }))
    await act(async () => root.unmount())
    requestCache.clear()
    globalThis.fetch = original
    for (const [key, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
})
