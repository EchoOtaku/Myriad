import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('phantasi source catalog fetch', () => {
  it('caches catalog and full source lists on separate keys', () => {
    const api = readFileSync(join(dir, 'phantasiApi.ts'), 'utf8')
    assert.match(api, /\/sources\?view=catalog/)
    assert.match(api, /phantasi:sources:catalog/)
    assert.match(api, /requestCache\.delete\('phantasi:sources:catalog'\)/)
  })
})
