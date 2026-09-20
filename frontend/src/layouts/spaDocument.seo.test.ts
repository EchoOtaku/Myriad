import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { renderDocument } from '../../scripts/vite/documentPlugin'

const template = readFileSync(
  new URL('../../index.html', import.meta.url),
  'utf8',
)

describe('SPA document contract', () => {
  it('renders all branding slots and release metadata before React', () => {
    const html = renderDocument(template, {
      PUBLIC_MYRIAD_VERSION: 'v1.2.3',
      PUBLIC_MYRIAD_COMMIT_SHA: 'abcdef1234567',
    })
    const slots = [...html.matchAll(/data-myriad-brand="([^"]+)"/g)]
      .map((match) => match[1])
      .sort()
    assert.deepEqual(
      slots,
      [
        'description',
        'favicon',
        'apple-touch',
        'app-title',
        'og-title',
        'og-description',
        'og-image',
        'title',
        'json',
        'json-ld',
      ].sort(),
    )
    assert.match(html, /name="myriad-version" content="v1.2.3"/)
    assert.match(html, /name="myriad-commit" content="abcdef1234567"/)
    assert.match(html, /"softwareVersion":"1.2.3"/)
    assert.doesNotMatch(html, /%DOCUMENT_|<!-- (?:boot|document):|astro-island/)
    assert.match(html, /application\/ld\+json/)
    assert.match(html, /WebApplication/)
    assert.match(html, /<noscript>/)
    assert.match(html, /id="myriad-site-brand"/)
    assert.match(html, /id="meta-description"/)
    assert.match(html, /name="referrer"/)
    const main = html.indexOf('src="/src/main.tsx"')
    for (const token of [
      '@font-face',
      '--font-inter',
      '--font-qwitcher-grypen',
      "localStorage.getItem('theme')",
      "u.searchParams.delete('_spa')",
    ]) {
      assert.ok(html.includes(token) && html.indexOf(token) < main, token)
    }
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/)
  })

  it('escapes release values and defaults to a development document', () => {
    const html = renderDocument(template, {
      PUBLIC_MYRIAD_VERSION: '</script><script>alert(1)</script>"',
    })
    assert.doesNotMatch(html, /<script>alert/)
    const dev = renderDocument(template)
    assert.match(dev, /name="myriad-version" content="dev"/)
    assert.doesNotMatch(dev, /softwareVersion/)
  })
})
