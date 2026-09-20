import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('spa-server cache headers', () => {
  it('treats hashed JS/CSS and vendored fonts as immutable', () => {
    const src = readFileSync(new URL('../scripts/spa-server.mjs', import.meta.url), 'utf8')
    const fn = src.slice(src.indexOf('function cacheControl'), src.indexOf('function contentType'))
    assert.match(fn, /urlPath\.startsWith\('\/assets\/'\)/)
    assert.ok(fn.includes('fonts'))
    assert.match(fn, /max-age=31536000, immutable/)
  })
})
