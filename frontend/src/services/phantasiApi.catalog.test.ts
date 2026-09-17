import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { requestCache } from '../utils/requestCache'
import { getSources } from './phantasiApi'
import { phantasiCacheKeys } from './phantasiCache'

const dir = dirname(fileURLToPath(import.meta.url))

afterEach(() => requestCache.deleteByPrefix('phantasi:sources'))

describe('phantasi source catalog fetch', () => {
  it('caches catalog and full source lists on separate keys', () => {
    const api = readFileSync(join(dir, 'phantasiApi.ts'), 'utf8')
    assert.match(api, /params\.set\('view', 'catalog'\)/)
    assert.match(api, /params\.set\('category', category\)/)
    assert.match(api, /phantasiCacheKeys\.sourceList/)
    assert.match(api, /invalidatePhantasiSourcesCache/)
    assert.equal(phantasiCacheKeys.sourceList(), 'phantasi:sources')
    assert.equal(phantasiCacheKeys.sourceList('catalog'), 'phantasi:sources:catalog')
    assert.equal(
      phantasiCacheKeys.sourceList('catalog', 'friends'),
      'phantasi:sources:catalog:cat:friends',
    )
    assert.equal(
      phantasiCacheKeys.sourceList(undefined, undefined, 'sites'),
      'phantasi:sources:board:sites',
    )
  })

  it('force refresh replaces an older shared request without stale refill', async () => {
    const original = globalThis.fetch
    const old = Promise.withResolvers<Response>()
    const fresh = Promise.withResolvers<Response>()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return calls === 1 ? old.promise : fresh.promise
    }) as typeof fetch
    try {
      const staleRequest = getSources()
      const freshRequest = getSources(undefined, { forceRefresh: true })
      fresh.resolve(Response.json({ sources: [{ id: 2 }] }))
      assert.equal((await freshRequest)[0]?.id, 2)
      old.resolve(Response.json({ sources: [{ id: 1 }] }))
      assert.equal((await staleRequest)[0]?.id, 1)
      assert.equal((await getSources())[0]?.id, 2)
      assert.equal(calls, 2)
    } finally {
      globalThis.fetch = original
    }
  })
})
