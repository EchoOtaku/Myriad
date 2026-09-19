import assert from 'node:assert/strict'
import test from 'node:test'
import { DebouncedLatestWriter } from './debouncedLatestWriter'

async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve() }
function setup() {
  const owner = new AbortController()
  const starts: string[] = []
  const errors: unknown[] = []
  const pending: Array<{ resolve: () => void, reject: (error: unknown) => void }> = []
  const queue = new DebouncedLatestWriter<string>({ signal: owner.signal, delay: 500,
    write: async value => {
      starts.push(value)
      await new Promise<void>((resolve, reject) => pending.push({ resolve, reject }))
    },
    onError: error => { errors.push(error) },
  })
  return { owner, starts, errors, pending, queue }
}

test('debounces before starting and serializes edits behind the active write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = setup()
  f.queue.enqueue('old')
  t.mock.timers.tick(400)
  f.queue.enqueue('first')
  t.mock.timers.tick(499)
  assert.deepEqual(f.starts, [])
  t.mock.timers.tick(1)
  assert.deepEqual(f.starts, ['first'])
  f.queue.enqueue('intermediate')
  t.mock.timers.tick(500)
  f.queue.enqueue('latest')
  t.mock.timers.tick(500)
  assert.deepEqual(f.starts, ['first'])
  f.pending[0].resolve()
  await flush()
  assert.deepEqual(f.starts, ['first', 'latest'])
  f.pending[1].resolve()
  await flush()
  f.owner.abort()
})

test('completion of an earlier write does not shorten the latest debounce', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = setup()
  f.queue.enqueue('first')
  t.mock.timers.tick(500)
  f.queue.enqueue('next')
  t.mock.timers.tick(200)
  f.pending[0].resolve()
  await flush()
  assert.deepEqual(f.starts, ['first'])
  t.mock.timers.tick(300)
  assert.deepEqual(f.starts, ['first', 'next'])
  f.pending[1].resolve()
  await flush()
  f.owner.abort()
})

test('a failed write reports the error and allows the latest pending save', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = setup()
  f.queue.enqueue('first')
  t.mock.timers.tick(500)
  f.queue.enqueue('next')
  t.mock.timers.tick(500)
  f.pending[0].reject('failure')
  await flush()
  assert.deepEqual(f.errors, ['failure'])
  assert.deepEqual(f.starts, ['first', 'next'])
  f.pending[1].resolve()
  await flush()
  f.owner.abort()
})

test('identity invalidation drops pending work and suppresses late errors', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = setup()
  f.queue.enqueue('first')
  t.mock.timers.tick(500)
  f.queue.enqueue('next')
  f.owner.abort()
  f.pending[0].reject(new Error('cancelled'))
  f.queue.enqueue('after logout')
  t.mock.timers.tick(1000)
  await flush()
  assert.deepEqual(f.starts, ['first'])
  assert.deepEqual(f.errors, [])
  const fresh = setup()
  fresh.queue.enqueue('never started')
  fresh.owner.abort()
  t.mock.timers.tick(1000)
  assert.deepEqual(fresh.starts, [])
})
