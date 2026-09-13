import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  rewriteSpaFallbackUrl,
  SPA_STATIC_PATHS,
  spaPrerenderPaths,
} from './spaPaths.mjs'

const catchAllSource = readFileSync(
  new URL('./pages/[...path].astro', import.meta.url),
  'utf8',
)
const fallbackSource = readFileSync(
  new URL('../scripts/astro/spaFallback.mjs', import.meta.url),
  'utf8',
)

describe('spaPaths', () => {
  it('is the only human-path table for prerender and dest fallback', () => {
    assert.match(catchAllSource, /spaPrerenderPaths/)
    assert.match(catchAllSource, /from ['"]\.\.\/spaPaths\.mjs['"]/)
    assert.doesNotMatch(catchAllSource, /const staticRoutes/)
    assert.match(fallbackSource, /rewriteSpaFallbackUrl/)
    assert.match(fallbackSource, /from ['"].*spaPaths\.mjs['"]/)
    assert.doesNotMatch(fallbackSource, /req\.url = '\/tapp\/run\/_'/)
  })

  it('prerenders every static shell plus dynamic placeholders', () => {
    const prod = spaPrerenderPaths(false)
    for (const route of [
      'library',
      'reports',
      'tapp',
      'tapp/store',
      'tapp/run',
      'brew',
    ]) {
      assert.ok(prod.includes(route), route)
    }
    assert.ok(prod.includes('tapp/run/_'))
    assert.ok(prod.includes('tapp/detail/_'))
    assert.equal(prod.includes('details'), false)
    assert.equal(prod.includes('federation/chat/_'), false)
    assert.equal(prod.includes('dev/brew-tiles'), false)
    assert.ok(spaPrerenderPaths(true).includes('dev/brew-tiles'))
    assert.ok(SPA_STATIC_PATHS.includes('config'))
    assert.ok(SPA_STATIC_PATHS.includes('agent/settings'))
  })

  it('rewrites dest URLs onto the prerendered files', () => {
    assert.equal(rewriteSpaFallbackUrl('/tapp/run/abc'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/run'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/run?x=1'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/run/_'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/detail/xyz'), '/tapp/detail/_')
    assert.equal(rewriteSpaFallbackUrl('/brew/item/12'), '/brew')
    assert.equal(rewriteSpaFallbackUrl('/details'), '/')
    assert.equal(rewriteSpaFallbackUrl('/federation/chat/room-1'), '/')
    assert.equal(rewriteSpaFallbackUrl('/federation/room/abc'), '/')
    assert.equal(rewriteSpaFallbackUrl('/library'), '/library')
  })
})
