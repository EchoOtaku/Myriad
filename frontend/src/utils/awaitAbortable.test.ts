import assert from 'node:assert/strict'
import test from 'node:test'
import { awaitAbortable } from './awaitAbortable'

test('cancelling one consumer leaves the shared operation available to another', async () => {
  const shared = Promise.withResolvers<string>()
  const first = new AbortController()
  const second = new AbortController()
  const a = awaitAbortable(shared.promise, first.signal)
  const b = awaitAbortable(shared.promise, second.signal)
  first.abort()
  await assert.rejects(a, { name: 'AbortError' })
  shared.resolve('token')
  assert.equal(await b, 'token')
})

test('already cancelled waits consume late failures without changing the cancellation reason', async () => {
  const shared = Promise.withResolvers<string>()
  const owner = new AbortController()
  owner.abort()
  const waiting = awaitAbortable(shared.promise, owner.signal)
  shared.reject(new Error('late failure'))
  await assert.rejects(waiting, error => error === owner.signal.reason)
})
