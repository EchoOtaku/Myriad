import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { NoteCloudFields, NoteCloudSaveHandle } from './useNoteCloudSave'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, beforeEach, it, mock } from 'node:test'
import { act, createElement, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CLOUD_SAVE_DEBOUNCE_MS, useNoteCloudSave } from './useNoteCloudSave'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
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
const empty: NoteCloudFields = { title: '', contentMd: '', topic: null, cover: null, publishedAt: null }
function doc(content: string, revision: number): PhantasiNoteDoc {
  return { id: 1, item_id: null, title: '', content_md: content, topic: null, image: null, published_at: null, status: 'draft', scheduled_at: null, revision, last_error: null, updated_at: 0 }
}
let root: Root
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] })
  root = createRoot(dom.window.document.getElementById('root'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  mock.timers.reset()
})
async function harness() {
  let cloud!: NoteCloudSaveHandle
  let fields = empty
  let edit!: (text: string) => void
  let revision!: { current: number }
  const requests: { input: Record<string, unknown>; resolve: (doc: PhantasiNoteDoc) => void; reject: (error: Error) => void }[] = []
  const saved: string[] = []
  function Harness() {
    const [current, setFields] = useState(empty)
    fields = current
    edit = (text) => setFields((value) => ({ ...value, contentMd: text }))
    revision = useRef(1)
    cloud = useNoteCloudSave({ cloudId: 1, loading: false, fields: current, revisionRef: revision,
      onServerDoc: () => {}, onMerged: setFields, onSaved: (value) => saved.push(value.contentMd), onError: () => {},
      labels: { saveFailed: 'failed', conflict: 'conflict' },
      io: { updateNoteDoc: (_id, input) => new Promise((resolve, reject) => requests.push({ input: { ...input }, resolve, reject })), getNoteDoc: async () => doc('remote', 2) },
    })
    return null
  }
  await act(async () => root.render(createElement(Harness)))
  return { get cloud() { return cloud }, get fields() { return fields }, get revision() { return revision.current }, requests, saved,
    edit: async (text: string) => act(async () => edit(text)),
    tick: async () => act(async () => mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS)),
  }
}
it('own WS receipt before HTTP retains typing after the submitted snapshot', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await h.edit('ab')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, h.requests[0].input.client_request_id as string))
  assert.equal(h.fields.contentMd, 'ab')
  assert.equal(h.cloud.baseRef.current.contentMd, 'a')
  await act(async () => h.requests[0].resolve(doc('a', 2)))
  assert.equal(h.fields.contentMd, 'ab')
  await h.tick()
  assert.equal(h.requests[1].input.content_md, 'ab')
  assert.equal(h.requests[1].input.revision, 2)
})
it('a late HTTP receipt cannot roll back a newer remote revision or replay local text', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, h.requests[0].input.client_request_id as string))
  await h.edit('ab')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a\nremote' }, 3))
  assert.equal(h.fields.contentMd, 'ab\nremote')
  await act(async () => h.requests[0].resolve(doc('a', 2)))
  assert.equal(h.revision, 3)
  assert.equal(h.cloud.baseRef.current.contentMd, 'a\nremote')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'old' }, 2))
  assert.equal(h.fields.contentMd, 'ab\nremote')
})
it('two clients retain interleaved edits and same-line conflicts through persisted snapshots', async () => {
  const h = await harness()
  await h.edit('local')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'other' }, 2))
  assert.equal(h.fields.contentMd, 'local\nother')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'other continued' }, 3))
  assert.equal(h.fields.contentMd, 'local\nother continued')
  await h.tick()
  assert.equal(h.requests[0].input.content_md, 'local\nother continued')
})

it('a newer remote snapshot received before our receipt does not replay the submitted edit', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await h.edit('ab')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a\nremote' }, 3))
  await act(async () => h.requests[0].resolve(doc('a', 2)))
  assert.equal(h.fields.contentMd, 'ab\nremote')
  assert.equal(h.revision, 3)
  assert.equal(h.requests[1].input.content_md, 'ab\nremote')
})

it('defers remote text and intermediate saves until composition ends', async () => {
  const h = await harness()
  await act(async () => h.cloud.compositionStart())
  await h.edit('拼')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'remote' }, 2))
  assert.equal(h.fields.contentMd, '拼')
  await h.tick()
  assert.equal(h.requests.length, 0)
  await h.edit('拼音')
  await act(async () => h.cloud.compositionEnd())
  await h.tick()
  assert.equal(h.fields.contentMd, '拼音\nremote')
  assert.equal(h.requests[0].input.content_md, '拼音\nremote')
})
