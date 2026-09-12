/** @vitest-environment node */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { siteBrandingInlineScript } from './siteBrandingScript.ts'
import { SITE_METADATA_CACHE_KEY } from './siteMetadataKeys.ts'

function applyBranding(siteMetadata: string | null) {
  const favicon = {
    href: '/favicon.webp',
    setAttribute(name: string, value: string) {
      if (name === 'href') this.href = value
    },
  }
  const apple = {
    href: '/icons/pwa/icon-192.png',
    setAttribute(name: string, value: string) {
      if (name === 'href') this.href = value
    },
  }
  const sandbox = createContext({
    localStorage: {
      getItem(key: string) {
        return key === SITE_METADATA_CACHE_KEY ? siteMetadata : null
      },
    },
    document: {
      title: 'Myriad - A myriad of lights, in one place.',
      querySelector(selector: string) {
        if (selector === 'link[rel="icon"]') return favicon
        if (selector === 'link[rel="apple-touch-icon"]') return apple
        return null
      },
    },
  })
  runInContext(siteBrandingInlineScript(), sandbox)
  return {
    title: (sandbox as { document: { title: string } }).document.title,
    favicon: favicon.href,
    apple: apple.href,
  }
}

describe('siteBrandingInlineScript', () => {
  it('is wired into both SPA shells after the default title tag', () => {
    for (const file of ['index.astro', '[...path].astro']) {
      const source = readFileSync(
        new URL(`../pages/${file}`, import.meta.url),
        'utf8',
      )
      assert.match(source, /SiteBrandingBoot/)
      const titleAt = source.indexOf('<title>{title}</title>')
      const bootAt = source.indexOf('<SiteBrandingBoot')
      assert.ok(titleAt >= 0 && bootAt > titleAt, file)
    }
  })

  it('paints cached title and icon over the baked defaults', () => {
    const painted = applyBranding(
      JSON.stringify({
        site_title: 'Kiseki',
        site_favicon: 'https://api.fuukei.org/myriad/frontend/public/siteicon.ico',
      }),
    )
    assert.equal(painted.title, 'Kiseki')
    assert.equal(
      painted.favicon,
      'https://api.fuukei.org/myriad/frontend/public/siteicon.ico',
    )
    assert.equal(
      painted.apple,
      'https://api.fuukei.org/myriad/frontend/public/siteicon.ico',
    )
  })

  it('rejects unsafe favicon schemes', () => {
    const painted = applyBranding(
      JSON.stringify({
        site_title: 'Kiseki',
        site_favicon: 'javascript:alert(1)',
      }),
    )
    assert.equal(painted.title, 'Kiseki')
    assert.equal(painted.favicon, '/favicon.webp')
  })

  it('leaves the baked chrome when cache is missing', () => {
    const painted = applyBranding(null)
    assert.match(painted.title, /Myriad/)
    assert.equal(painted.favicon, '/favicon.webp')
  })
})
