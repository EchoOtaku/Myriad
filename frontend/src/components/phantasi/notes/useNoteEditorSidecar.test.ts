import type { PhantasiNoteAuthor } from '../../../types/phantasi'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useNoteEditorSidecar } from './useNoteEditorSidecar'

it('opening note settings loads author metadata without downloading the document', async () => {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
  const prior = new Map<string, PropertyDescriptor | undefined>()
  const urls: string[] = []
  const author = { user_id: 7, user_name: 'author', role: 'owner' }
  let authors: PhantasiNoteAuthor[] = []
  let candidates: PhantasiNoteAuthor[] = []
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'https://test.invalid').pathname
      urls.push(path)
      if (path.endsWith('/notes/docs/917/authors')) return Response.json({ authors: [author] })
      if (path.endsWith('/notes/author-candidates')) return Response.json({ candidates: [author] })
      if (path.endsWith('/categories')) return Response.json({ categories: [] })
      if (path.endsWith('/items')) return Response.json({ items: [] })
      throw new Error(`Unexpected body request: ${path}`)
    },
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const setAuthors = (next: PhantasiNoteAuthor[] | ((value: PhantasiNoteAuthor[]) => PhantasiNoteAuthor[])) => {
    authors = typeof next === 'function' ? next(authors) : next
  }
  const setAuthorCandidates = (next: PhantasiNoteAuthor[] | ((value: PhantasiNoteAuthor[]) => PhantasiNoteAuthor[])) => {
    candidates = typeof next === 'function' ? next(candidates) : next
  }
  const setCategoryNames = () => {}
  function Harness({ settingsOpen }: { settingsOpen: boolean }) {
    const textarea = useRef<HTMLTextAreaElement | null>(null)
    useNoteEditorSidecar({
      loadFailed: 'Load failed', cloudId: 917, settingsOpen, loading: true,
      pane: 'write', title: 'Title', contentMd: 'Already loaded document',
      titleInputRef: textarea, textareaRef: textarea,
      setAuthors, setAuthorCandidates, setCategoryNames,
    })
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(Harness, { settingsOpen: false })))
    assert.equal(urls.some(path => path.includes('/notes/')), false)
    await act(async () => root.render(createElement(Harness, { settingsOpen: true })))
    assert.deepEqual(authors, [author])
    assert.deepEqual(candidates, [author])
    assert.equal(urls.filter(path => path.endsWith('/notes/docs/917/authors')).length, 1)
    assert.equal(urls.some(path => path.endsWith('/notes/docs/917')), false)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
