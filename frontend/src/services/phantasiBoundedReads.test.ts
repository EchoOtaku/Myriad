import assert from 'node:assert/strict'
import { it } from 'node:test'
import { getCommentReplies, getComments, syncReadingStates } from './phantasiApi'

it('chunks sync and merges all per-item outcomes without losing prior confirmations', async () => {
  const original = globalThis.fetch
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
  const sizes: number[] = []
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('csrf-token')) return Response.json({ csrf_token: null })
    const { states } = JSON.parse(String(init?.body))
    sizes.push(states.length)
    const ids = states.map((s: { item_id: number }) => s.item_id)
    return Response.json({ synced: ids.length - 1, confirmed: ids.slice(1), failed: [ids[0]], revisions: Object.fromEntries(ids.slice(1).map((id: number) => [id, 2])), conflicts: [{ item_id: ids[0], server_revision: 3, server_updated_at: 1, client_updated_at: 0 }] })
  }
  try {
    const result = await syncReadingStates(Array.from({ length: 205 }, (_, i) => ({ item_id: i + 1, updated_at: 0 })))
    assert.deepEqual(sizes, [100, 100, 5])
    assert.equal(result.synced, 202)
    assert.deepEqual(result.failed, [1, 101, 201])
    assert.equal(result.confirmed?.length, 202)
    assert.equal(result.revisions?.[205], 2)
    assert.equal(result.conflicts.length, 3)
  } finally {
    globalThis.fetch = original
    if (storage) Object.defineProperty(globalThis, 'sessionStorage', storage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

it('collects comment and reply pages while preserving display order and cancellation', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    const url = String(input)
    urls.push(url)
    const last = url.includes('after_id=2')
    const rows = last ? [{ id: 3, start_offset: 0, created_at: 1000 }] : [{ id: 1, start_offset: null, created_at: 3000 }, { id: 2, start_offset: 10, created_at: 2000 }]
    return Response.json({ success: true, comments: rows, replies: rows, can_write: true, has_comments: true, next_cursor: last ? null : 2 })
  }
  try {
    const comments = await getComments(1)
    assert.deepEqual(comments.comments.map(c => c.id), [3, 2, 1])
    assert.equal(comments.can_write, true)
    const replies = await getCommentReplies(1)
    assert.deepEqual(replies.replies.map(c => c.id), [3, 2, 1])
    assert.equal(urls.length, 4)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(getComments(1, undefined, { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(urls.length, 4)
  } finally { globalThis.fetch = original }
})

it('preserves committed sync outcomes when a later batch fails and stops sending', async () => {
  const original = globalThis.fetch
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
  let calls = 0
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('csrf-token')) return Response.json({ csrf_token: null })
    calls++
    if (calls === 2) return Response.json({ error: 'Sync unavailable' }, { status: 503 })
    const { states } = JSON.parse(String(init?.body))
    return Response.json({ synced: states.length, confirmed: states.map((s: { item_id: number }) => s.item_id), failed: [], conflicts: [], revisions: { 1: 2 } })
  }
  try {
    const result = await syncReadingStates(Array.from({ length: 205 }, (_, i) => ({ item_id: i + 1, updated_at: 0 })))
    assert.equal(calls, 2)
    assert.equal(result.synced, 100)
    assert.equal(result.confirmed?.length, 100)
    assert.deepEqual(result.revisions, { 1: 2 })
    assert.deepEqual(result.failed, Array.from({ length: 105 }, (_, i) => i + 101))
  } finally {
    globalThis.fetch = original
    if (storage) Object.defineProperty(globalThis, 'sessionStorage', storage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

it('stops on repeated pagination cursors and on cancellation between pages', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({ success: true, comments: [], next_cursor: 2 })
  }
  try {
    await assert.rejects(getComments(1), /Invalid comment pagination cursor/)
    assert.equal(calls, 2)
    const controller = new AbortController()
    globalThis.fetch = async () => {
      controller.abort()
      return Response.json({ success: true, comments: [], next_cursor: 3 })
    }
    await assert.rejects(getComments(1, undefined, { signal: controller.signal }), { name: 'AbortError' })
  } finally { globalThis.fetch = original }
})
