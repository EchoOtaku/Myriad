import assert from 'node:assert/strict'
import { it } from 'node:test'
import { act } from 'react'
import { deferred, mountNoteHook } from './noteHookTestUtils'
import { useNoteAiEdit } from './useNoteAiEdit'

const document = { identity: '1:2', title: 'Title', topic: null, contentMd: 'Original' }
const response = { content_md: '**Original**', html: '<p><strong>Original</strong></p>' }

it('previews without writing, applies once, and can undo the exact AI change', async () => {
  const writes: string[] = []
  const hook = await mountNoteHook(current => useNoteAiEdit({ current, locale: 'en-US', request: async () => response, apply: value => writes.push(value) }), document)
  try {
    await act(async () => { hook.current.open(null) })
    await act(async () => { await hook.current.generate() })
    assert.deepEqual(writes, [])
    assert.equal(hook.current.result?.content_md, '**Original**')
    await act(async () => { hook.current.applyResult(); hook.current.applyResult() })
    assert.deepEqual(writes, ['**Original**'])
    await hook.render({ ...document, contentMd: '**Original**' })
    await act(async () => { hook.current.undo() })
    assert.deepEqual(writes, ['**Original**', 'Original'])
  } finally { await hook.close() }
})
it('blocks stale results and refuses undo after subsequent edits', async () => {
  const pending = deferred<typeof response>()
  const writes: string[] = []
  const hook = await mountNoteHook(current => useNoteAiEdit({ current, locale: 'en-US', request: () => pending.promise, apply: value => writes.push(value) }), document)
  try {
    await act(async () => { hook.current.open(null) })
    let run!: Promise<void>
    await act(async () => { run = hook.current.generate() })
    await hook.render({ ...document, contentMd: 'New typing' })
    await act(async () => { pending.resolve(response); await run })
    assert.equal(hook.current.stale, true)
    await act(async () => { hook.current.applyResult(); hook.current.undo() })
    assert.deepEqual(writes, [])
  } finally { await hook.close() }
})
it('closing cancels a request and a late reply cannot reopen or replace its result', async () => {
  const pending = deferred<typeof response>()
  let signal!: AbortSignal
  const hook = await mountNoteHook(current => useNoteAiEdit({ current, locale: 'en-US', request: (_input, nextSignal) => { signal = nextSignal; return pending.promise }, apply: () => assert.fail('must not apply') }), document)
  try {
    await act(async () => { hook.current.open(null) })
    let run!: Promise<void>
    await act(async () => { run = hook.current.generate(); hook.current.close() })
    assert.equal(signal.aborted, true)
    await act(async () => { pending.resolve(response); await run })
    assert.equal(hook.current.isOpen, false)
    assert.equal(hook.current.result, null)
  } finally { await hook.close() }
})

it('a later manual edit cannot be overwritten by Undo AI changes', async () => {
  const writes: string[] = []
  const hook = await mountNoteHook(current => useNoteAiEdit({ current, locale: 'en-US', request: async () => response, apply: value => writes.push(value) }), document)
  try {
    await act(async () => { hook.current.open(null) })
    await act(async () => { await hook.current.generate() })
    await act(async () => { hook.current.applyResult() })
    await hook.render({ ...document, contentMd: '**Original** plus new writing' })
    assert.equal(hook.current.canUndo, false)
    await act(async () => { hook.current.undo() })
    assert.deepEqual(writes, ['**Original**'])
  } finally { await hook.close() }
})

it('switching document identity cancels generation and removes the previous draft', async () => {
  const pending = deferred<typeof response>()
  const hook = await mountNoteHook(current => useNoteAiEdit({ current, locale: 'en-US', request: () => pending.promise, apply: () => assert.fail('old account response must not apply') }), document)
  try {
    await act(async () => { hook.current.open(null) })
    let run!: Promise<void>
    await act(async () => { run = hook.current.generate() })
    await hook.render({ ...document, identity: 'other:2' })
    await act(async () => { pending.resolve(response); await run })
    assert.equal(hook.current.isOpen, false)
    assert.equal(hook.current.result, null)
    assert.equal(hook.current.snapshot, null)
  } finally { await hook.close() }
})
