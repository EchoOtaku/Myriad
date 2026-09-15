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
      'journal',
    ]) {
      assert.ok(prod.includes(route), route)
    }
    assert.ok(prod.includes('tapp/run/_'))
    assert.ok(prod.includes('tapp/detail/_'))
    assert.equal(prod.includes('details'), false)
    assert.equal(prod.includes('federation/chat/_'), false)
    assert.equal(prod.includes('dev/phantasi-tiles'), false)
    assert.ok(spaPrerenderPaths(true).includes('dev/phantasi-tiles'))
    assert.ok(SPA_STATIC_PATHS.includes('config'))
    assert.ok(SPA_STATIC_PATHS.includes('agent/settings'))
  })

  it('rewrites dest URLs onto the prerendered files', () => {
    assert.equal(rewriteSpaFallbackUrl('/tapp/run/abc'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/run'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/run?x=1'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/run/_'), '/tapp/run/_')
    assert.equal(rewriteSpaFallbackUrl('/tapp/detail/xyz'), '/tapp/detail/_')
    assert.equal(rewriteSpaFallbackUrl('/journal/articles/12'), '/journal')
    assert.equal(rewriteSpaFallbackUrl('/journal/notes'), '/journal')
    assert.equal(rewriteSpaFallbackUrl('/journal/workbench/feeds/add'), '/journal')
    assert.equal(rewriteSpaFallbackUrl('/phantasi'), '/phantasi')
    assert.equal(rewriteSpaFallbackUrl('/phantasi/item/12'), '/phantasi/item/12')
    assert.equal(rewriteSpaFallbackUrl('/details'), '/')
    assert.equal(rewriteSpaFallbackUrl('/federation/chat/room-1'), '/')
    assert.equal(rewriteSpaFallbackUrl('/federation/room/abc'), '/')
    assert.equal(rewriteSpaFallbackUrl('/library'), '/library')
  })
})
