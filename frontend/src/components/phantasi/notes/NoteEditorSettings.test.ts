import type { NoteHistoryEntry } from '../../../services/phantasiApi'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import React, { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nNamespace } from '../../../contexts/I18nContext'
import { loadShellLocale, loadShellNamespace } from '../../../i18n/loadLocale'
import { NoteEditorSettings } from './NoteEditorSettings'

it('history downloads only the selected version and ignores a stale selection response', async () => {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
  dom.window.localStorage.setItem('locale', 'en-US')
  await Promise.all([loadShellLocale('en-US'), loadShellNamespace('phantasi', 'en-US')])
  const prior = new Map<string, PropertyDescriptor | undefined>()
  const urls: string[] = []
  const entries: NoteHistoryEntry[] = [1, 2].map(revision => ({
    revision, actor_id: 1, actor_name: 'Writer', saved_at: revision * 1000,
    snapshot: { title: `Version ${revision}`, content_md: `Body ${revision}`, topic: null, image: null, published_at: null },
  }))
  let finishSecond!: (response: Response) => void
  let restored: NoteHistoryEntry | undefined
  for (const [key, value] of Object.entries({
    React, window: dom.window, document: dom.window.document, Node: dom.window.Node,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'https://test.invalid').pathname
      urls.push(path)
      if (path.endsWith('/history')) {
        return Response.json({
          history: entries.map(({ snapshot, ...entry }) => ({
            ...entry, snapshot: { title: snapshot.title, topic: null, image: null, published_at: null },
          })),
        })
      }
      if (path.endsWith('/history/2')) return new Promise<Response>(resolve => { finishSecond = resolve })
      if (path.endsWith('/history/1')) return Response.json({ entry: entries[0] })
      throw new Error(`Unexpected request: ${path}`)
    },
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(I18nNamespace, {
      names: ['phantasi'],
      children: createElement(NoteEditorSettings, {
        cloudId: 918, defaultView: 'write', preferenceBusy: false, busy: false,
        onDefaultView: async () => {}, onRestore: async entry => { restored = entry },
      }),
    })))
    assert.deepEqual(urls, ['/api/phantasi/notes/docs/918/history'])
    assert.equal(dom.window.document.querySelector('pre'), null)
    const versions = dom.window.document.querySelectorAll<HTMLButtonElement>('.phantasi-note__history-entry')
    assert.equal(versions.length, 2)
    await act(async () => versions[1].click())
    assert.equal(urls.at(-1), '/api/phantasi/notes/docs/918/history/2')
    await act(async () => versions[0].click())
    assert.equal(dom.window.document.querySelector('pre')?.textContent, 'Body 1')
    await act(async () => finishSecond(Response.json({ entry: entries[1] })))
    assert.equal(dom.window.document.querySelector('pre')?.textContent, 'Body 1')
    const restore = dom.window.document.querySelector<HTMLButtonElement>('.phantasi-note__history-preview button')!
    await act(async () => restore.click())
    assert.deepEqual(restored, entries[0])
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
