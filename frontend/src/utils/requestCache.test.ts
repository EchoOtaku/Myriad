import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RequestCache } from './requestCache'

function deferred<T>() {
  return Promise.withResolvers<T>()
}

describe('request cache invalidation', () => {
  for (const invalidate of [
    (cache: RequestCache) => cache.delete('phantasi:item:1'),
    (cache: RequestCache) => cache.deleteByPrefix('phantasi:'),
    (cache: RequestCache) => cache.clear(),
  ]) {
    it('does not refill invalidated entries from an older response', async () => {
      const cache = new RequestCache()
      const old = deferred<string>()
      const pending = cache.fetch('phantasi:item:1', () => old.promise)
      invalidate(cache)
      old.resolve('old')
      assert.equal(await pending, 'old')
      assert.equal(cache.get('phantasi:item:1'), null)
    })
  }

  for (const fails of [false, true]) {
    it(`keeps newer requests deduplicated when an old request ${fails ? 'fails' : 'succeeds'}`, async () => {
      const cache = new RequestCache()
      const old = deferred<string>()
      const fresh = deferred<string>()
      const pending = cache
        .fetch('phantasi:item:1', () => old.promise)
        .catch(() => null)
      cache.delete('phantasi:item:1')
      const next = cache.fetch('phantasi:item:1', () => fresh.promise)
      if (fails) old.reject(new Error('old failed'))
      else old.resolve('old')
      await pending
      const joined = cache.fetch('phantasi:item:1', () => {
        assert.fail('new request must still be deduplicated')
      })
      fresh.resolve('new')
      assert.deepEqual(await Promise.all([next, joined]), ['new', 'new'])
      assert.equal(cache.get('phantasi:item:1'), 'new')
    })
  }

  it('does not overwrite a newer completed request or explicit write', async () => {
    const cache = new RequestCache()
    const old = deferred<string>()
    const pending = cache.fetch('phantasi:item:1', () => old.promise)
    cache.delete('phantasi:item:1')
    await cache.fetch('phantasi:item:1', async () => 'new')
    old.resolve('old')
    await pending
    assert.equal(cache.get('phantasi:item:1'), 'new')
    cache.delete('phantasi:item:1')
    const later = deferred<string>()
    const loading = cache.fetch('phantasi:item:1', () => later.promise)
    cache.set('phantasi:item:1', 'mutation')
    later.resolve('stale')
    await loading
    assert.equal(cache.get('phantasi:item:1'), 'mutation')
  })
})

describe('shared request cancellation', () => {
  it('cancels one consumer immediately without aborting another consumer', async () => {
    const cache = new RequestCache()
    const result = deferred<string>()
    const a = new AbortController()
    const b = new AbortController()
    let transport!: AbortSignal
    const first = cache.fetch('shared', signal => { transport = signal; return result.promise }, 1000, false, a.signal)
    const second = cache.fetch('shared', () => assert.fail('must share transport'), 1000, false, b.signal)
    a.abort()
    await assert.rejects(first, { name: 'AbortError' })
    assert.equal(transport.aborted, false)
    result.resolve('body')
    assert.equal(await second, 'body')
    assert.equal(await cache.fetch('shared', () => assert.fail('must use cache')), 'body')
  })

  it('aborts transport after the last consumer leaves and rejects stale cache fills', async () => {
    const cache = new RequestCache()
    const old = deferred<string>()
    const owner = new AbortController()
    let transport!: AbortSignal
    const request = cache.fetch('body', signal => { transport = signal; return old.promise }, 1000, false, owner.signal)
    owner.abort()
    await assert.rejects(request, { name: 'AbortError' })
    assert.equal(transport.aborted, true)
    assert.equal(await cache.fetch('body', async () => 'fresh'), 'fresh')
    old.resolve('obsolete')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(cache.get('body'), 'fresh')
  })

  it('reuses transport during a same-turn cancellation handoff', async () => {
    const cache = new RequestCache()
    const result = deferred<string>()
    const owner = new AbortController()
    let transport!: AbortSignal
    const first = cache.fetch('handoff', signal => { transport = signal; return result.promise }, 1000, false, owner.signal)
    owner.abort()
    const second = cache.fetch('handoff', () => assert.fail('handoff must not restart IO'))
    await assert.rejects(first, { name: 'AbortError' })
    assert.equal(transport.aborted, false)
    result.resolve('shared')
    assert.equal(await second, 'shared')
  })

  it('cleans cancelled pending entries even if a loader ignores transport cancellation', async () => {
    const cache = new RequestCache()
    const result = deferred<string>()
    const owner = new AbortController()
    const pending = cache.fetch('abandoned', () => result.promise, 1000, false, owner.signal)
    owner.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    result.resolve('unused')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(cache.get('abandoned'), null)
    assert.equal(cache.getStatus().pending, 0)
  })

  it('does not start IO for an already cancelled consumer and retries synchronous failures', async () => {
    const cache = new RequestCache()
    await assert.rejects(cache.fetch('aborted', () => assert.fail('must not fetch'), 1000, false, AbortSignal.abort()), { name: 'AbortError' })
    await assert.rejects(cache.fetch('retry', () => { throw new Error('sync failure') }), /sync failure/)
    assert.equal(await cache.fetch('retry', async () => 'recovered'), 'recovered')
  })
})
