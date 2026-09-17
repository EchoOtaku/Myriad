import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('geoLocation fallbacks', () => {
  it('does not use mixed-content HTTP geo APIs', () => {
    const src = readFileSync(new URL('./geoLocation.ts', import.meta.url), 'utf8')
    assert.equal(src.includes('http://ip-api.com'), false)
    assert.match(src, /https:\/\/ipapi\.co\/json\//)
    assert.match(src, /https:\/\/get\.geojs\.io\/v1\/ip\/geo\.json/)
  })
})
