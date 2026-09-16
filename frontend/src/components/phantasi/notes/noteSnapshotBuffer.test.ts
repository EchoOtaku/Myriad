import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { NoteRemoteSnapshot } from './noteSnapshotBuffer'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { NoteSnapshotBuffer } from './noteSnapshotBuffer'

const fields = { title: '', contentMd: 'a', topic: null, cover: null, publishedAt: null }
function snapshot(revision: number, requestId?: string): NoteRemoteSnapshot {
  return { fields: { ...fields, contentMd: `revision ${revision}` }, revision, requestId }
}
function document(revision: number): PhantasiNoteDoc {
  return { id: 1, item_id: 91, title: '', content_md: `revision ${revision}`, topic: null,
    image: null, published_at: null, status: 'published', scheduled_at: null, revision, last_error: null, updated_at: 0 }
}

it('a long composition retains only its own receipt and the newest whole-document snapshot', () => {
  const buffer = new NoteSnapshotBuffer()
  const receipt = snapshot(2, 'own')
  buffer.push(receipt, 'own')
  for (let revision = 3; revision <= 10_000; revision += 1) {
    buffer.push(snapshot(revision), 'own')
    assert.ok(buffer.size <= 2)
  }
  assert.deepEqual(buffer.drain(), [receipt, snapshot(10_000)])
  assert.equal(buffer.size, 0)
})

function permutations<T>(values: T[]): T[][] {
  if (values.length === 0) return [[]]
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]))
}

it('all HTTP/WS arrival orders preserve receipt identity and publication metadata at each retained revision', () => {
  const messages = [snapshot(2, 'own'), { ...snapshot(2, 'own'), doc: document(2) }, snapshot(3), { ...snapshot(3), doc: document(3) }]
  for (const order of permutations(messages)) {
    const buffer = new NoteSnapshotBuffer()
    for (const message of order) buffer.push(message, 'own')
    const result = buffer.drain()
    assert.deepEqual(result.map(value => value.revision), [2, 3])
    assert.equal(result[0].requestId, 'own')
    assert.deepEqual(result[0].doc, document(2))
    assert.deepEqual(result[1].doc, document(3))
  }
})

it('stale packets and duplicates cannot evict a newer snapshot', () => {
  const buffer = new NoteSnapshotBuffer()
  buffer.push(snapshot(8))
  buffer.push(snapshot(3))
  buffer.push(snapshot(8))
  assert.deepEqual(buffer.drain(), [snapshot(8)])
})
