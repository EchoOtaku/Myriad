import assert from 'node:assert/strict'
import { afterEach, it } from 'node:test'
import { requestCache } from '../../utils/requestCache'
import { BOARD_NOTES_CACHE_PREFIX, loadBoardNotes } from './pageData'

afterEach(() => requestCache.deleteByPrefix(BOARD_NOTES_CACHE_PREFIX))

it('cancelling one notes consumer preserves shared pages and progress for another', async () => {
  const original = globalThis.fetch
  const first = Promise.withResolvers<Response>()
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls === 1) return first.promise
    return Response.json({ items: [{ id: 2, source_id: 4, title: 'older', published_at: 1 }], next_cursor: null })
  }) as typeof fetch
  const abandoned = new AbortController()
  try {
    const a = loadBoardNotes([{ id: 4, source_type: 'note' }], abandoned.signal).catch(error => error)
    const snapshots: number[][] = []
    const b = loadBoardNotes([{ id: 4, source_type: 'note' }], undefined, notes => snapshots.push(notes.map(note => note.id)))
    abandoned.abort()
    first.resolve(Response.json({ items: [{ id: 3, source_id: 4, title: 'newer', published_at: 2 }], next_cursor: 'next' }))
    assert.equal((await a).name, 'AbortError')
    assert.deepEqual((await b).map(note => note.id), [3, 2])
    assert.deepEqual(snapshots, [[3], [3, 2]])
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})

it('many note sources do not create an unbounded request burst', async () => {
  const original = globalThis.fetch
  let active = 0
  let peak = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const id = Number(new URL(String(input), 'https://test.invalid').searchParams.get('source_id'))
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    return Response.json({ items: [{ id, source_id: id, title: String(id), published_at: id }], next_cursor: null })
  }) as typeof fetch
  try {
    const notes = await loadBoardNotes(Array.from({ length: 12 }, (_, i) => ({ id: i + 1, source_type: 'note' })))
    assert.equal(notes.length, 12)
    assert.ok(peak <= 3, `issued ${peak} simultaneous requests`)
    assert.deepEqual(notes.map(note => note.id), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  } finally { globalThis.fetch = original }
})
