import type { Root } from 'react-dom/client'
import type { NoteEditorDefaultView } from '../../../services/phantasiApi'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, it } from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useNoteEditorPreference } from './useNoteEditorPreference'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
beforeEach(() => { root = createRoot(document.getElementById('root')!) })
afterEach(async () => { await act(async () => root.unmount()) })

it('loads the account default, persists changes and keeps the confirmed choice after failed writes', async () => {
  const applied: string[] = []
  const writes: string[] = []
  let errors = 0
  let fail = false
  let preference!: ReturnType<typeof useNoteEditorPreference>
  const io = {
    getNoteEditorPreference: async () => 'write' as NoteEditorDefaultView,
    saveNoteEditorPreference: async (view: NoteEditorDefaultView) => { if (fail) throw new Error('offline'); writes.push(view) },
  }
  function Harness() {
    preference = useNoteEditorPreference(1, view => applied.push(view), () => errors++, io)
    return null
  }
  await act(async () => root.render(createElement(Harness)))
  assert.deepEqual(applied, ['write'])
  assert.equal(preference.defaultView, 'write')
  await act(async () => preference.changeDefaultView('preview'))
  assert.deepEqual(writes, ['preview'])
  assert.equal(preference.defaultView, 'preview')
  fail = true
  await act(async () => preference.changeDefaultView('visual'))
  assert.equal(preference.defaultView, 'preview')
  assert.equal(errors, 1)
})

it('late responses for the previous account never replace the current preference', async () => {
  const pending: Array<(view: NoteEditorDefaultView) => void> = []
  const applied: string[] = []
  let preference!: ReturnType<typeof useNoteEditorPreference>
  const io = {
    getNoteEditorPreference: () => new Promise<NoteEditorDefaultView>(resolve => pending.push(resolve)),
    saveNoteEditorPreference: async () => {},
  }
  function Harness({ userId }: { userId: number }) {
    preference = useNoteEditorPreference(userId, view => applied.push(view), () => {}, io)
    return null
  }
  await act(async () => root.render(createElement(Harness, { userId: 1 })))
  assert.equal(preference.defaultView, 'visual')
  await act(async () => root.render(createElement(Harness, { userId: 2 })))
  await act(async () => pending[1]('preview'))
  await act(async () => pending[0]('write'))
  assert.deepEqual(applied, ['preview'])
  assert.equal(preference.defaultView, 'preview')
})
