import assert from 'node:assert/strict'
import test from 'node:test'
import { createPermissionConfigStore } from './permissionConfig'

const response = (allowed: boolean) => ({ success: true, config: { guest: { ai_chat: allowed }, user: { ai_chat: allowed } } })

test('saving permissions invalidates subscribers and late old responses cannot restore old grants', async () => {
  const old = Promise.withResolvers<ReturnType<typeof response>>()
  const fresh = Promise.withResolvers<ReturnType<typeof response>>()
  let calls = 0
  const store = createPermissionConfigStore(() => ++calls === 1 ? old.promise : fresh.promise)
  const seen: boolean[] = []
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().loaded))
  const first = store.load()
  await Promise.resolve()
  store.invalidate()
  const next = store.load()
  fresh.resolve(response(false))
  await next
  old.resolve(response(true))
  await first
  assert.equal(calls, 2)
  assert.deepEqual(store.getSnapshot(), { loaded: true, elevatedAiChat: { user: false, guest: false } })
  assert.deepEqual(seen, [false, true])
  unsubscribe()
})

test('a failed permission read can retry and concurrent readers share one request', async () => {
  let calls = 0
  const store = createPermissionConfigStore(async () => { if (++calls === 1) throw new Error('offline'); return response(true) })
  await Promise.all([store.load(), store.load()])
  assert.equal(calls, 1)
  assert.deepEqual(store.getSnapshot(), { loaded: true })
  await store.load()
  assert.equal(store.getSnapshot().elevatedAiChat?.guest, true)
})
