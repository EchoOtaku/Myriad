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
