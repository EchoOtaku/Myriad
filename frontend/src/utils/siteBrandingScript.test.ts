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
      getElementById() {
        return null
      },
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
  it('is wired into the shared SPA document after the default title tag', () => {
    const source = readFileSync(
      new URL('../layouts/SpaDocument.astro', import.meta.url),
      'utf8',
    )
    assert.match(source, /SiteBrandingBoot/)
    const titleAt = source.search(/<title(?:\s[^>]*)?>\{title\}<\/title>/)
    const bootAt = source.indexOf('<SiteBrandingBoot')
    assert.ok(titleAt >= 0 && bootAt > titleAt)
  })

  it('keeps both page entries on the shared document shell', () => {
    for (const file of ['index.astro', '[...path].astro']) {
      const source = readFileSync(
        new URL(`../pages/${file}`, import.meta.url),
        'utf8',
      )
      assert.match(source, /SpaDocument/)
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

  it('prefers the first-byte document brand over localStorage', () => {
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
        getItem() {
          return JSON.stringify({
            site_title: 'Stale',
            site_favicon: '/old.ico',
          })
        },
      },
      document: {
        title: 'Myriad - A myriad of lights, in one place.',
        getElementById(id: string) {
          if (id !== 'myriad-site-brand') return null
          return {
            textContent: JSON.stringify({
              site_title: 'Kiseki',
              site_favicon: '/siteicon.ico',
            }),
          }
        },
        querySelector(selector: string) {
          if (selector === 'link[rel="icon"]') return favicon
          if (selector === 'link[rel="apple-touch-icon"]') return apple
          return null
        },
      },
    })
    runInContext(siteBrandingInlineScript(), sandbox)
    assert.equal(
      (sandbox as { document: { title: string } }).document.title,
      'Kiseki',
    )
    assert.equal(favicon.href, '/siteicon.ico')
  })

  it('leaves the baked chrome when cache is missing', () => {
    const painted = applyBranding(null)
    assert.match(painted.title, /Myriad/)
    assert.equal(painted.favicon, '/favicon.webp')
  })
})
