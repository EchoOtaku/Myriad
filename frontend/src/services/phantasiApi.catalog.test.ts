import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { requestCache } from '../utils/requestCache'
import { getSources } from './phantasiApi'

const dir = dirname(fileURLToPath(import.meta.url))

afterEach(() => requestCache.deleteByPrefix('phantasi:sources'))

describe('phantasi source catalog fetch', () => {
  it('caches catalog and full source lists on separate keys', () => {
    const api = readFileSync(join(dir, 'phantasiApi.ts'), 'utf8')
    assert.match(api, /\/sources\?view=catalog/)
    assert.match(api, /phantasiCacheKeys\.sourceCatalog/)
    assert.match(api, /invalidatePhantasiSourcesCache/)
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
