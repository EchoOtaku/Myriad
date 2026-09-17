import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_BRAND_FAVICON,
  DEFAULT_BRAND_TITLE,
  escapeHtml,
  fetchStampBrand,
  isAllowedMetadataUrl,
  sanitizeStampFavicon,
  sanitizeStampOgImage,
  SITE_BRAND_ELEMENT_ID,
  SITE_ICON_API_PATH,
  stampDocumentHtml,
  stampWebManifest,
} from '../../scripts/siteBrandingStamp.mjs'
import { SITE_BRAND_ELEMENT_ID as SITE_BRAND_ELEMENT_ID_TS } from './siteMetadataKeys.ts'

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <meta name="description" content="A myriad of lights, in one place." data-myriad-brand="description" />
    <link rel="icon" href="/favicon.webp" data-myriad-brand="favicon" />
    <link rel="apple-touch-icon" href="/icons/pwa/icon-192.png" data-myriad-brand="apple-touch" />
    <meta name="apple-mobile-web-app-title" content="Myriad" data-myriad-brand="app-title" />
    <meta property="og:title" content="Myriad" data-myriad-brand="og-title" />
    <meta property="og:description" content="A myriad of lights, in one place." data-myriad-brand="og-description" />
    <meta property="og:image" content="" data-myriad-brand="og-image" />
    <title data-myriad-brand="title">Myriad - A myriad of lights, in one place.</title>
    <script type="application/json" data-myriad-brand="json">{}</script>
    <script type="application/ld+json" data-myriad-brand="json-ld">{"@type":"WebApplication","name":"Myriad","description":"old"}</script>
  </head>
</html>`

describe('isAllowedMetadataUrl', () => {
  it('accepts only the public metadata path over http(s)', () => {
    assert.equal(
      isAllowedMetadataUrl('http://backend:1103/api/config/metadata'),
      true,
    )
    assert.equal(
      isAllowedMetadataUrl('https://api.example.com/api/config/metadata'),
      true,
    )
  })

  it('rejects userinfo, query, hash, and other paths', () => {
    assert.equal(
      isAllowedMetadataUrl('http://user:pass@backend:1103/api/config/metadata'),
      false,
    )
    assert.equal(
      isAllowedMetadataUrl('http://backend:1103/api/config/metadata?x=1'),
      false,
    )
    assert.equal(
      isAllowedMetadataUrl('http://backend:1103/api/config/metadata#x'),
      false,
    )
    assert.equal(
      isAllowedMetadataUrl('http://backend:1103/api/config/other'),
      false,
    )
    assert.equal(isAllowedMetadataUrl('file:///etc/passwd'), false)
    assert.equal(isAllowedMetadataUrl(''), false)
  })

  it('does not fetch when the metadata URL is not allowlisted', async () => {
    assert.equal(await fetchStampBrand('http://backend:1103/api/config/other'), null)
    assert.equal(await fetchStampBrand('file:///etc/passwd'), null)
  })
})

describe('sanitizeStampFavicon', () => {
  it('keeps same-origin paths, http(s), and image data URIs', () => {
    assert.equal(sanitizeStampFavicon('/siteicon.ico'), '/siteicon.ico')
    assert.equal(
      sanitizeStampFavicon('https://cdn.example.com/icon.ico'),
      'https://cdn.example.com/icon.ico',
    )
    assert.equal(
      sanitizeStampFavicon('data:image/png;base64,abc'),
      'data:image/png;base64,abc',
    )
  })

  it('rejects protocol-relative, scheme-in-path, and credentialed URLs', () => {
    assert.equal(sanitizeStampFavicon('//evil.example/x'), '')
    assert.equal(sanitizeStampFavicon('/javascript:alert(1)'), '')
    assert.equal(sanitizeStampFavicon('javascript:alert(1)'), '')
    assert.equal(sanitizeStampFavicon('https://user:pass@evil.example/x'), '')
  })
})

describe('sanitizeStampOgImage', () => {
  it('allows path and http(s), rejects data and credentials', () => {
    assert.equal(sanitizeStampOgImage('/og.png'), '/og.png')
    assert.equal(sanitizeStampOgImage('https://cdn.example/og.png'), 'https://cdn.example/og.png')
    assert.equal(sanitizeStampOgImage('data:image/png;base64,aaa'), '')
    assert.equal(sanitizeStampOgImage('https://user:pass@evil.example/x'), '')
    assert.equal(SITE_BRAND_ELEMENT_ID, SITE_BRAND_ELEMENT_ID_TS)
  })
})

describe('stampDocumentHtml', () => {
  it('replaces only branded slots and HTML-escapes values', () => {
    const stamped = stampDocumentHtml(SAMPLE_HTML, {
      site_title: 'Fuukei <script>',
      site_description: 'Lights & "stars"',
      site_favicon: 'https://cdn.example.com/icon.ico',
    })
    assert.match(stamped, /<title data-myriad-brand="title">Fuukei &lt;script&gt;<\/title>/)
    assert.match(
      stamped,
      /content="Lights &amp; &quot;stars&quot;"/,
    )
    assert.match(stamped, /href="https:\/\/cdn.example.com\/icon.ico"/)
    assert.match(stamped, /apple-mobile-web-app-title" content="Fuukei &lt;s/)
    assert.match(stamped, /property="og:title" content="Fuukei &lt;script&gt;"/)
    assert.match(stamped, /data-myriad-brand="json">\{"site_title":"Fuukei \\u003cscript\\u003e"/)
    assert.match(stamped, /"name":"Fuukei \\u003cscript\\u003e"/)
    assert.doesNotMatch(stamped, /data-myriad-brand="og-image"/)
  })

  it('leaves unmarked tags and fail-opens on empty brand', () => {
    const unmarked = '<title>Stay</title><link rel="icon" href="/favicon.webp" />'
    assert.equal(stampDocumentHtml(unmarked, { site_title: 'X' }), unmarked)

    const stamped = stampDocumentHtml(SAMPLE_HTML, {})
    assert.match(stamped, new RegExp(`<title data-myriad-brand="title">${escapeHtml(DEFAULT_BRAND_TITLE)}</title>`))
    assert.match(stamped, new RegExp(`href="${DEFAULT_BRAND_FAVICON}"`))
  })
})

describe('stampWebManifest', () => {
  it('uses the site icon path for remote favicons', () => {
    const stamped = stampWebManifest(
      { name: 'Myriad', icons: [{ src: '/icons/pwa/icon-192.png' }] },
      {
        site_title: 'Fuukei',
        site_description: 'Lights',
        site_favicon: 'https://cdn.example.com/icon.ico',
      },
    )
    assert.equal(stamped.name, 'Fuukei')
    assert.equal(stamped.short_name, 'Fuukei')
    assert.equal(stamped.icons.length, 1)
    assert.equal(stamped.icons[0].src, SITE_ICON_API_PATH)
    assert.equal(stamped.icons[0].sizes, 'any')
  })

  it('keeps packaged icons when favicon is the default', () => {
    const base = { name: 'Myriad', icons: [{ src: '/icons/pwa/icon-192.png' }] }
    const stamped = stampWebManifest(base, { site_title: 'Fuukei' })
    assert.deepEqual(stamped.icons, base.icons)
    assert.equal(stamped.name, 'Fuukei')
  })
})
