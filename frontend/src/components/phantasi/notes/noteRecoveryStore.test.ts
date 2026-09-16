import assert from 'node:assert/strict'
import { beforeEach, it } from 'node:test'
import { listNoteRecoveryCopies, NoteRecoveryWriter } from './noteRecoveryStore'

const scope = { userId: 1, docId: 7 }
const base = { title: 'Title', contentMd: '', topic: null, cover: null, publishedAt: null }
let entries: Map<string, string>
let failWrites = false
beforeEach(() => {
  const dismissed = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => dismissed.get(key) ?? null,
    setItem: (key: string, value: string) => dismissed.set(key, value),
  } })
  entries = new Map()
  failWrites = false
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return entries.size },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new DOMException('Full', 'QuotaExceededError')
      entries.set(key, value)
    },
    removeItem: (key: string) => entries.delete(key),
  } })
})

it('independent writers never erase or overwrite each other, including clean mounts and discards', () => {
  const first = new NoteRecoveryWriter()
  const second = new NoteRecoveryWriter()
  first.write(scope, { ...base, contentMd: 'first' }, base, 1)
  second.write(scope, base, base, 1)
  assert.deepEqual(listNoteRecoveryCopies(scope).map(copy => copy.recovery.fields.contentMd), ['first'])
  second.write(scope, { ...base, contentMd: 'second' }, base, 1)
  assert.deepEqual(new Set(listNoteRecoveryCopies(scope).map(copy => copy.recovery.fields.contentMd)), new Set(['first', 'second']))
  second.clear()
  assert.deepEqual(listNoteRecoveryCopies(scope).map(copy => copy.recovery.fields.contentMd), ['first'])
})

it('failed replacement preserves the last durable copy', () => {
  const writer = new NoteRecoveryWriter()
  writer.write(scope, { ...base, contentMd: 'durable' }, base, 1)
  failWrites = true
  assert.equal(writer.write(scope, { ...base, contentMd: 'newer' }, base, 1), false)
  assert.equal(listNoteRecoveryCopies(scope)[0].recovery.fields.contentMd, 'durable')
})

it('cleanup of an older immutable snapshot cannot remove a newer write', () => {
  const writer = new NoteRecoveryWriter()
  writer.write(scope, { ...base, contentMd: 'old' }, base, 1)
  const old = listNoteRecoveryCopies(scope)[0]
  writer.write(scope, { ...base, contentMd: 'new' }, base, 1)
  NoteRecoveryWriter.consume(old)
  assert.equal(listNoteRecoveryCopies(scope)[0].recovery.fields.contentMd, 'new')
})

it('repeated writes retain one snapshot per writer and no-op rerenders do not change its recovery priority', () => {
  const writer = new NoteRecoveryWriter()
  for (let i = 0; i < 1_000; i += 1) writer.write(scope, { ...base, contentMd: `edit ${i}` }, base, 1)
  const before = listNoteRecoveryCopies(scope)
  writer.write(scope, { ...base, contentMd: 'edit 999' }, base, 1)
  assert.deepEqual(listNoteRecoveryCopies(scope), before)
  assert.equal(entries.size, 1)
})

it('copies remain isolated by account and document', () => {
  const writer = new NoteRecoveryWriter()
  writer.write(scope, { ...base, contentMd: 'private' }, base, 1)
  assert.deepEqual(listNoteRecoveryCopies({ userId: 2, docId: 7 }), [])
  assert.deepEqual(listNoteRecoveryCopies({ userId: 1, docId: 8 }), [])
})

it('discarding a recovered foreign copy does not erase it or restore it again in the same tab', () => {
  const first = new NoteRecoveryWriter()
  first.write(scope, { ...base, contentMd: 'first window' }, base, 1)
  const reopened = new NoteRecoveryWriter()
  assert.equal(reopened.load(scope)?.fields.contentMd, 'first window')
  reopened.discard()
  assert.equal(listNoteRecoveryCopies(scope)[0].recovery.fields.contentMd, 'first window')
  assert.equal(new NoteRecoveryWriter().load(scope), null)
})

it('saving a different fork cannot consume the originating window recovery', () => {
  const first = new NoteRecoveryWriter()
  first.write(scope, { ...base, contentMd: 'first window' }, base, 1)
  const second = new NoteRecoveryWriter()
  second.load(scope)
  second.confirmRecovered({ ...base, contentMd: 'second window rewrite' })
  assert.equal(listNoteRecoveryCopies(scope)[0].recovery.fields.contentMd, 'first window')
  second.confirmRecovered({ ...base, contentMd: 'first window' })
  assert.deepEqual(listNoteRecoveryCopies(scope), [])
})

it('retiring a legacy snapshot never deletes a concurrently replaced legacy record', () => {
  const key = 'phantasi:note-draft:user:1:doc:7'
  const recovery = { version: 2, fields: { ...base, contentMd: 'old' }, base, revision: 1, savedAt: Date.now() }
  entries.set(key, JSON.stringify(recovery))
  const old = listNoteRecoveryCopies(scope)[0]
  entries.set(key, JSON.stringify({ ...recovery, fields: { ...base, contentMd: 'new' } }))
  NoteRecoveryWriter.consume(old)
  assert.equal(listNoteRecoveryCopies(scope)[0].recovery.fields.contentMd, 'new')
})

it('reusing a writer for another document never moves or clears the original recovery', () => {
  const writer = new NoteRecoveryWriter()
  const fields = { ...base, contentMd: 'same text in distinct documents' }
  writer.write(scope, fields, base, 1)
  const other = { userId: 1, docId: 8 }
  writer.write(other, fields, base, 1)
  assert.equal(listNoteRecoveryCopies(scope).length, 1)
  assert.equal(listNoteRecoveryCopies(other).length, 1)
  writer.clear()
  assert.equal(listNoteRecoveryCopies(scope).length, 1)
  assert.equal(listNoteRecoveryCopies(other).length, 0)
})

it('dismissing a legacy snapshot does not hide a newer snapshot written to that same legacy key', () => {
  const key = 'phantasi:note-draft:user:1:doc:7'
  const recovery = { version: 2, fields: { ...base, contentMd: 'old' }, base, revision: 1, savedAt: Date.now() }
  entries.set(key, JSON.stringify(recovery))
  const writer = new NoteRecoveryWriter()
  writer.load(scope)
  writer.discard()
  assert.equal(new NoteRecoveryWriter().load(scope), null)
  entries.set(key, JSON.stringify({ ...recovery, fields: { ...base, contentMd: 'new' } }))
  assert.equal(new NoteRecoveryWriter().load(scope)?.fields.contentMd, 'new')
})
