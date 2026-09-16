import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { NoteCloudFields } from './useNoteCloudSave'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { act } from 'react'
import { deferred, mountNoteHook } from './noteHookTestUtils'
import { useNoteCloudSave } from './useNoteCloudSave'

const base: NoteCloudFields = { title: 'Title', contentMd: 'base', topic: null, cover: null, publishedAt: 1 }
function doc(revision: number, content = 'edited'): PhantasiNoteDoc {
  return {
  id: 7, item_id: null, title: 'Title', content_md: content, topic: null, image: null,
  published_at: 1, scheduled_at: null, status: 'draft', revision, last_error: null, updated_at: 1,
}
}

it('an explicit document write waits for autosave and receives the acknowledged revision', async () => {
  const pending = deferred<PhantasiNoteDoc>()
  const revisionRef = { current: 1 }
  const writes: number[] = []
  const hook = await mountNoteHook((fields: NoteCloudFields) => useNoteCloudSave({
    userId: 1,
    cloudId: 7, loading: false, fields, revisionRef,
    onServerDoc: () => {}, onMerged: () => {}, onSaved: () => {}, onError: () => {},
    labels: { saveFailed: 'failed', conflict: 'conflict' },
    io: {
      updateNoteDoc: async (_id, input) => { writes.push(input.revision!); return pending.promise },
      getNoteDoc: async () => doc(1),
    },
  }), base)
  try {
    await hook.render({ ...base, contentMd: 'edited' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)) })
    assert.deepEqual(writes, [1])
    assert.equal(typeof hook.current.runWrite, 'function')
    let publishedRevision: number | undefined
    const publish = hook.current.runWrite(async () => { publishedRevision = revisionRef.current })
    await act(async () => { await Promise.resolve() })
    assert.equal(publishedRevision, undefined)
    await act(async () => { pending.resolve(doc(2)); await publish })
    assert.equal(publishedRevision, 2)
  } finally { pending.resolve(doc(2)); await hook.close() }
})

it('a late autosave response cannot roll back a newer collaboration acknowledgement', async () => {
  const pending = deferred<PhantasiNoteDoc>()
  const revisionRef = { current: 1 }
  const saved: string[] = []
  const hook = await mountNoteHook((fields: NoteCloudFields) => useNoteCloudSave({
    userId: 1,
    cloudId: 7, loading: false, fields, revisionRef,
    onServerDoc: (server) => { revisionRef.current = server.revision },
    onMerged: () => {}, onSaved: (fields) => saved.push(fields.contentMd), onError: () => {},
    labels: { saveFailed: 'failed', conflict: 'conflict' },
    io: { updateNoteDoc: async () => pending.promise, getNoteDoc: async () => doc(3, 'newer') },
  }), base)
  try {
    await hook.render({ ...base, contentMd: 'edited' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)) })
    revisionRef.current = 3
    hook.current.ack({ ...base, contentMd: 'newer' })
    await act(async () => { pending.resolve(doc(2)); await pending.promise })
    assert.equal(revisionRef.current, 3)
    assert.equal(hook.current.baseRef.current.contentMd, 'newer')
    assert.deepEqual(saved, [])
  } finally { pending.resolve(doc(2)); await hook.close() }
})

it('acknowledges the returned server snapshot and does not save again when only revision changes', async () => {
  let calls = 0
  const revisionRef = { current: 1 }
  let acknowledged: NoteCloudFields | undefined
  const hook = await mountNoteHook((fields: NoteCloudFields) => useNoteCloudSave({
    userId: 1,
    cloudId: 7, loading: false, fields, revisionRef,
    onServerDoc: () => {}, onMerged: () => {}, onSaved: (fields) => { acknowledged = fields }, onError: () => {},
    labels: { saveFailed: 'failed', conflict: 'conflict' },
    io: {
      updateNoteDoc: async () => { calls++; return { ...doc(2), topic: null } },
      getNoteDoc: async () => doc(2),
    },
  }), base)
  try {
    await hook.render({ ...base, contentMd: 'edited', topic: '  ' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)) })
    assert.equal(acknowledged?.topic, null, 'saved baseline must reflect server normalization')
    await hook.render({ ...base, contentMd: 'edited' })
    revisionRef.current = 3
    await hook.render({ ...base, contentMd: 'edited' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)) })
    assert.equal(calls, 1)
  } finally { await hook.close() }
})

it('unmounting discards queued mutations without submitting them under a later editor lifetime', async () => {
  const pending = deferred<void>()
  const hook = await mountNoteHook(() => useNoteCloudSave({
    userId: 1,
    cloudId: 7, loading: false, fields: base, revisionRef: { current: 1 },
    onServerDoc: () => {}, onMerged: () => {}, onSaved: () => {}, onError: () => {},
    labels: { saveFailed: 'failed', conflict: 'conflict' },
  }), undefined)
  let submitted = false
  const first = hook.current.runWrite(() => pending.promise)
  await Promise.resolve()
  const queued = hook.current.runWrite(async () => { submitted = true })
  const rejected = assert.rejects(queued, { name: 'AbortError' })
  await hook.close()
  pending.resolve()
  await first
  await rejected
  assert.equal(submitted, false)
})

it('a queued command uses the conflict-merged fields instead of the pre-save editor snapshot', async () => {
  const pending = deferred<PhantasiNoteDoc>()
  let attempts = 0
  const revisionRef = { current: 1 }
  const hook = await mountNoteHook((fields: NoteCloudFields) => useNoteCloudSave({
    userId: 1,
    cloudId: 7, loading: false, fields, revisionRef,
    onServerDoc: () => {}, onMerged: () => {}, onSaved: () => {}, onError: () => {},
    labels: { saveFailed: 'save failed', conflict: 'draft conflict' },
    io: {
      updateNoteDoc: async (_id, input) => {
        if (++attempts === 1) return pending.promise
        return doc(3, input.content_md)
      },
      getNoteDoc: async () => doc(2, 'first\nREMOTE'),
    },
  }), { ...base, contentMd: 'first\nsecond' })
  try {
    await hook.render({ ...base, contentMd: 'LOCAL\nsecond' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)) })
    let commandFields: NoteCloudFields | undefined
    const command = hook.current.runWrite(async (fields) => { commandFields = fields })
    await act(async () => { pending.reject(new Error('draft conflict')); await command })
    assert.equal(commandFields?.contentMd, 'LOCAL\nREMOTE')
    assert.equal(revisionRef.current, 3)
  } finally { pending.resolve(doc(2)); await hook.close() }
})
