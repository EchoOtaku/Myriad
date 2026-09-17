import type { PhantasiBoard } from './logic/board'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { requestCache } from '../../utils/requestCache'
import { topicFeedId } from './logic/feedStories'
import { makeSource } from './logic/fixtures'
import { useFeedStories } from './useBoardPage'

it('feed and topic requests are deduplicated and stop when their board leaves', async () => {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
  const prior = new Map<string, PropertyDescriptor | undefined>()
  const reads: Array<{ url: URL; signal: AbortSignal }> = []
  let catalogs = 0
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, Node: dom.window.Node,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://test.invalid')
      if (url.pathname.endsWith('/topics')) {
        catalogs++
        return Response.json({ topics: ['AI'], cards: ['AI'] })
      }
      assert.equal(url.pathname, '/api/phantasi/items')
      const signal = init!.signal!
      reads.push({ url, signal })
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const sources = [makeSource({ id: 99381, recent_items: [] })]
  let hook!: ReturnType<typeof useFeedStories>
  function Harness({ board }: { board: PhantasiBoard }) {
    hook = useFeedStories(board, sources)
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  const render = (board: PhantasiBoard) => root.render(createElement(StrictMode, null, createElement(Harness, { board })))
  try {
    requestCache.clear()
    await act(async () => render('feeds'))
    assert.equal(reads.length, 1)
    assert.equal(reads[0].url.searchParams.get('source_id'), '99381')
    await act(async () => {
      hook.jump(topicFeedId(0))
      hook.jump(topicFeedId(0))
    })
    assert.equal(reads.length, 2)
    assert.equal(reads[1].url.searchParams.get('topic'), 'AI')
    await act(async () => render('notes'))
    assert.ok(reads.every(read => read.signal.aborted))
    assert.equal(reads.length, 2)
    await act(async () => render('feeds'))
    assert.equal(reads.length, 3)
    assert.equal(catalogs, 1)
    await act(async () => root.render(null))
    assert.ok(reads.every(read => read.signal.aborted))
  } finally {
    await act(async () => root.unmount())
    requestCache.clear()
    dom.window.close()
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
