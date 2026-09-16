import type { Root } from 'react-dom/client'
import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { NoteCloudFields, NoteCloudSaveHandle } from './useNoteCloudSave'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, beforeEach, it, mock } from 'node:test'
import { act, createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from '../../../services/api'
import { readNoteRecovery } from './noteDraft'
import { CLOUD_SAVE_DEBOUNCE_MS, useNoteCloudSave } from './useNoteCloudSave'
import { useNoteCollab } from './useNoteCollab'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' })
const prior = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
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
  localStorage.clear()
  mock.timers.enable({ apis: ['setTimeout'] })
  root = createRoot(dom.window.document.getElementById('root'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  mock.timers.reset()
})
async function harness(mount = root, collaboration = false) {
  let fresh = doc('', 1)
  let cloud!: NoteCloudSaveHandle
  let fields = empty
  let edit!: (text: string) => void
  let revision!: { current: number }
  const requests: { input: Record<string, unknown>; resolve: (doc: PhantasiNoteDoc) => void; reject: (error: Error) => void }[] = []
  const saved: string[] = []
  const serverDocs: PhantasiNoteDoc[] = []
  function Harness() {
    const [current, setFields] = useState(empty)
    fields = current
    edit = (text) => setFields((value) => ({ ...value, contentMd: text }))
    revision = useRef(1)
    cloud = useNoteCloudSave({ userId: 1, cloudId: 1, loading: false, fields: current, revisionRef: revision,
      onServerDoc: value => serverDocs.push(value), onMerged: setFields, onSaved: (value) => saved.push(value.contentMd), onError: () => {},
      labels: { saveFailed: 'failed', conflict: 'conflict', uncertain: 'unconfirmed' },
      io: { updateNoteDoc: (_id, input) => new Promise((resolve, reject) => requests.push({ input: { ...input }, resolve, reject })), getNoteDoc: async () => fresh },
    })
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    useNoteCollab({ cloudId: 1, loading: !collaboration, fields: current, cloud, textareaRef,
      io: { getNoteDoc: async () => fresh, noteDocWsUrl: () => 'wss://test.invalid/notes/1' },
    })
    return null
  }
  await act(async () => mount.render(createElement(Harness)))
  return { writeDoc: (writer: (fields: NoteCloudFields, revision: number, requestId: string) => Promise<PhantasiNoteDoc>) =>
    cloud.runWrite(async (fields, track) => {
      const receipt = track(fields)
      const doc = await writer(fields, revision.current, receipt.requestId)
      await receipt.receiveDoc(doc)
      return doc
    }), get cloud() { return cloud }, get fields() { return fields }, get revision() { return revision.current }, requests, saved, serverDocs, setFresh: (value: PhantasiNoteDoc) => { fresh = value },
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

it('two mounted clients resolve a revision conflict and converge without dropping either author', async () => {
  const second = createRoot(dom.window.document.createElement('div'))
  try {
    const a = await harness()
    const b = await harness(second)
    await a.edit('Alice')
    await b.edit('Bob')
    await a.tick()
    assert.equal(a.requests.length, 1)
    assert.equal(b.requests.length, 1)
    await act(async () => a.requests[0].resolve(doc('Alice', 2)))
    await act(async () => b.cloud.receiveRemote({ ...empty, contentMd: 'Alice' }, 2))
    b.setFresh(doc('Alice', 2))
    await act(async () => b.requests[0].reject(new ApiError('Note draft was updated elsewhere', 409)))
    assert.equal(b.fields.contentMd, 'Bob\nAlice')
    assert.equal(b.requests[1].input.content_md, 'Bob\nAlice')
    await b.edit('Bob continued\nAlice')
    await act(async () => {
      a.cloud.receiveRemote({ ...empty, contentMd: 'Bob\nAlice' }, 3)
      b.requests[1].resolve(doc('Bob\nAlice', 3))
    })
    assert.equal(a.fields.contentMd, 'Bob\nAlice')
    assert.equal(b.fields.contentMd, 'Bob continued\nAlice')
    assert.equal(b.requests[2].input.content_md, 'Bob continued\nAlice')
    await act(async () => {
      a.cloud.receiveRemote({ ...empty, contentMd: 'Bob continued\nAlice' }, 4)
      b.requests[2].resolve(doc('Bob continued\nAlice', 4))
    })
    assert.equal(a.fields.contentMd, b.fields.contentMd)
    assert.equal(a.revision, 4)
    assert.equal(b.revision, 4)
  } finally { await act(async () => second.unmount()) }
})

it('WS ignores unversioned text, clears metadata, and fetches missed commits after reconnect', async () => {
  const sockets: FakeSocket[] = []
  class FakeSocket {
    static OPEN = 1
    readyState = 1
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    constructor() { sockets.push(this) }
    send() {}
    close() { this.readyState = 3; this.onclose?.() }
    message(value: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(value) }) }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket })
  try {
    const h = await harness(root, true)
    await act(async () => sockets[0].onopen?.())
    await act(async () => sockets[0].message({ type: 'edit', peer_id: 'other', user_id: 2, title: 'old title', content_md: 'obsolete snapshot' }))
    assert.equal(h.fields.contentMd, '')
    await act(async () => sockets[0].message({ type: 'doc', peer_id: '', user_id: 2, revision: 2, title: '', content_md: 'remote', topic: 'topic', image: 'image', published_at: 100 }))
    assert.equal(h.fields.topic, 'topic')
    await act(async () => sockets[0].message({ type: 'doc', peer_id: '', user_id: 2, revision: 3, title: '', content_md: 'remote', topic: null, image: null, published_at: null }))
    assert.equal(h.fields.topic, null)
    assert.equal(h.fields.cover, null)
    assert.equal(h.fields.publishedAt, null)
    assert.equal(sockets.length, 1, 'committed field updates must not reconnect the socket')
    h.setFresh(doc('missed while offline', 4))
    await act(async () => sockets[0].close())
    await act(async () => mock.timers.tick(1000))
    assert.equal(sockets.length, 2)
    await act(async () => sockets[1].onopen?.())
    assert.equal(h.fields.contentMd, 'missed while offline')
    assert.equal(h.revision, 4)
    await act(async () => root.unmount())
  } finally {
    if (previous) Object.defineProperty(globalThis, 'WebSocket', previous)
    else Reflect.deleteProperty(globalThis, 'WebSocket')
  }
})

it('manual writes wait for autosave and use its confirmed revision plus latest typing', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await h.edit('ab')
  let manualInput: { fields: NoteCloudFields; revision: number; id: string } | undefined
  let finish!: (value: PhantasiNoteDoc) => void
  let writing!: Promise<PhantasiNoteDoc>
  await act(async () => {
    writing = h.writeDoc((fields, revision, id) => {
      manualInput = { fields, revision, id }
      return new Promise((resolve) => { finish = resolve })
    })
  })
  assert.equal(manualInput, undefined)
  await act(async () => h.requests[0].resolve(doc('a', 2)))
  assert.equal(manualInput?.fields.contentMd, 'ab')
  assert.equal(manualInput?.revision, 2)
  await h.edit('abc')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'ab' }, 3, manualInput?.id))
  assert.equal(h.fields.contentMd, 'abc')
  await act(async () => { finish(doc('ab', 3)); await writing })
  assert.equal(h.requests[1].input.content_md, 'abc')
  assert.equal(h.requests[1].input.revision, 3)
})

it('a failed manual write rejects its caller and releases autosave', async () => {
  const h = await harness()
  await h.edit('draft')
  await act(async () => {
    await assert.rejects(h.writeDoc(async () => { throw new ApiError('invalid request', 400) }), /invalid request/)
  })
  assert.equal(h.requests[0].input.content_md, 'draft')
  await act(async () => h.requests[0].resolve(doc('draft', 2)))
  assert.equal(h.cloud.baseRef.current.contentMd, 'draft')
})

it('manual writes wait for the complete IME input', async () => {
  const h = await harness()
  await act(async () => h.cloud.compositionStart())
  await h.edit('拼')
  let received: NoteCloudFields | undefined
  let writing!: Promise<PhantasiNoteDoc>
  await act(async () => {
    writing = h.writeDoc(async (fields) => { received = fields; return doc(fields.contentMd, 2) })
  })
  assert.equal(received, undefined)
  await h.edit('拼音')
  await act(async () => h.cloud.compositionEnd())
  await h.tick()
  await writing
  assert.equal(received?.contentMd, '拼音')
})

it('an ambiguous network failure preserves local text and blocks blind retries until an identifiable receipt', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await h.edit('ab')
  await act(async () => h.requests[0].reject(new Error('network unavailable')))
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a\nremote' }, 3))
  assert.equal(h.fields.contentMd, 'ab')
  await h.tick()
  assert.equal(h.requests.length, 1)
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, h.requests[0].input.client_request_id as string))
  assert.equal(h.fields.contentMd, 'ab\nremote')
  assert.equal(h.requests[1].input.content_md, 'ab\nremote')
})

it('an equal-revision reconnect fetch during IME preserves the queued own request identity', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await act(async () => h.cloud.compositionStart())
  await h.edit('ab')
  await act(async () => {
    h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, h.requests[0].input.client_request_id as string)
    h.cloud.receiveDoc(doc('a', 2))
    h.requests[0].resolve(doc('a', 2))
  })
  await act(async () => h.cloud.compositionEnd())
  await h.tick()
  assert.equal(h.fields.contentMd, 'ab')
  assert.equal(h.requests[1].input.content_md, 'ab')
  assert.equal(h.requests[1].input.revision, 2)
})

it('manual receipts use server-normalized fields and retain continued typing', async () => {
  const h = await harness()
  await h.edit('text')
  let complete!: (value: PhantasiNoteDoc) => void
  let writing!: Promise<PhantasiNoteDoc>
  await act(async () => { writing = h.writeDoc(() => new Promise((resolve) => { complete = resolve })) })
  await h.edit('text continued')
  await act(async () => {
    complete({ ...doc('text', 2), title: 'Normalized title', topic: 'normalized' })
    await writing
  })
  assert.equal(h.fields.title, 'Normalized title')
  assert.equal(h.fields.topic, 'normalized')
  assert.equal(h.fields.contentMd, 'text continued')
  assert.equal(h.cloud.baseRef.current.title, 'Normalized title')
})

it('an exact persisted snapshot can resolve an ambiguous failure without a WS identity', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  await h.edit('ab')
  await act(async () => h.requests[0].reject(new Error('network unavailable')))
  await act(async () => h.cloud.receiveDoc(doc('a', 2)))
  assert.equal(h.fields.contentMd, 'ab')
  assert.equal(h.requests[1].input.content_md, 'ab')
  assert.equal(h.requests[1].input.revision, 2)
})

it('an ambiguous manual failure keeps the cause and blocks subsequent writes', async () => {
  const h = await harness()
  await h.edit('local')
  const failure = new Error('connection lost')
  await act(async () => {
    await assert.rejects(h.writeDoc(async () => { throw failure }), (error: Error) => {
      assert.equal(error.message, 'unconfirmed')
      assert.equal(error.cause, failure)
      return true
    })
  })
  await h.tick()
  assert.equal(h.requests.length, 0)
  await act(async () => h.cloud.receiveDoc(doc('different remote', 2)))
  assert.equal(h.fields.contentMd, 'local')
  await assert.rejects(h.writeDoc(async () => doc('wrong', 3)), /unconfirmed/)
  assert.equal(h.requests.length, 0)
})

it('restored ambiguous saves block automatic and manual writes until identified', async () => {
  const h = await harness()
  await h.edit('ab')
  await act(async () => h.cloud.restorePending({ requestId: 'before-reopen', fields: { ...empty, contentMd: 'a' } }))
  await h.tick()
  assert.equal(h.requests.length, 0)
  await act(async () => h.cloud.receiveDoc(doc('a remote', 3)))
  assert.equal(h.fields.contentMd, 'ab')
  await assert.rejects(h.writeDoc(async () => doc('wrong', 4)), /unconfirmed/)
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, 'before-reopen'))
  assert.equal(h.requests[0].input.revision, 3)
})

it('durable pending recovery retains the original baseline until its late receipt arrives', async () => {
  const h = await harness()
  await h.edit('ab')
  const pending = { requestId: 'before-reopen', fields: { ...empty, contentMd: 'a' } }
  await act(async () => {
    h.cloud.receiveDoc(doc('a\nremote', 3))
    h.cloud.restorePending(pending, { fields: empty, revision: 1 }, doc('a\nremote', 3))
  })
  await h.edit('ab')
  await h.tick()
  const recovery = readNoteRecovery({ userId: 1, docId: 1 })!
  assert.equal(recovery.revision, 1)
  assert.equal(recovery.base.contentMd, '')
  assert.deepEqual(recovery.pending, pending)
  assert.equal(h.requests.length, 0)
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, pending.requestId))
  assert.equal(h.fields.contentMd, 'ab\nremote')
  assert.equal(h.requests[0].input.revision, 3)
})

for (const outcome of ['success', 'network-failure'] as const) {
  it(`a late autosave ${outcome} after closing cannot rewrite pending recovery`, async () => {
    const h = await harness()
    await h.edit('a')
    await h.tick()
    await h.edit('ab')
    const before = readNoteRecovery({ userId: 1, docId: 1 })!
    assert.equal(before.pending?.requestId, h.requests[0].input.client_request_id)
    await act(async () => root.unmount())
    await act(async () => {
      if (outcome === 'success') h.requests[0].resolve(doc('a', 2))
      else h.requests[0].reject(new Error('connection lost'))
    })
    assert.deepEqual(readNoteRecovery({ userId: 1, docId: 1 }), before)
  })
}

it('a detached manual write cannot resurrect a discarded recovery copy', async () => {
  const h = await harness()
  await h.edit('local')
  let complete!: (value: PhantasiNoteDoc) => void
  let writing!: Promise<PhantasiNoteDoc>
  await act(async () => { writing = h.writeDoc(() => new Promise(resolve => { complete = resolve })) })
  h.cloud.discardRecovery()
  await act(async () => root.unmount())
  await act(async () => { complete(doc('local', 2)); await writing })
  assert.equal(readNoteRecovery({ userId: 1, docId: 1 }), null)
})

it('a newer document deferred during IME retains publication metadata until our receipt arrives', async () => {
  const h = await harness()
  await h.edit('a')
  await h.tick()
  h.cloud.compositionStart()
  await h.edit('ab')
  const remote = { ...doc('a\nremote', 3), status: 'published' as const, item_id: 91 }
  await act(async () => h.cloud.receiveDoc(remote))
  await act(async () => h.cloud.compositionEnd())
  await h.tick()
  assert.equal(h.fields.contentMd, 'ab')
  await act(async () => h.cloud.receiveRemote({ ...empty, contentMd: 'a' }, 2, h.requests[0].input.client_request_id as string))
  assert.equal(h.fields.contentMd, 'ab\nremote')
  assert.deepEqual(h.serverDocs.at(-1), remote)
})

it('a long IME remote burst is applied once with the latest text and metadata', async () => {
  const h = await harness()
  h.cloud.compositionStart()
  await h.edit('local')
  await act(async () => {
    for (let revision = 2; revision <= 1_000; revision += 1) {
      h.cloud.receiveDoc({ ...doc(`remote ${revision}`, revision), status: 'published', item_id: 91 })
    }
  })
  assert.equal(h.fields.contentMd, 'local')
  assert.equal(h.serverDocs.length, 0)
  await act(async () => h.cloud.compositionEnd())
  await h.tick()
  assert.equal(h.fields.contentMd, 'local\nremote 1000')
  assert.equal(h.serverDocs.length, 1)
  assert.equal(h.serverDocs[0].revision, 1_000)
  assert.equal(h.serverDocs[0].status, 'published')
  assert.equal(h.requests[0].input.revision, 1_000)
})

it('opening an unchanged second editor cannot erase the first editor recovery', async () => {
  const first = await harness()
  await first.edit('unconfirmed in the first window')
  const before = readNoteRecovery({ userId: 1, docId: 1 })!
  const second = createRoot(document.createElement('div'))
  try {
    await harness(second)
    assert.deepEqual(readNoteRecovery({ userId: 1, docId: 1 }), before)
  } finally { await act(async () => second.unmount()) }
})
