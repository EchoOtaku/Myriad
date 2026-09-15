import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const documentSource = readFileSync(
  new URL('./SpaDocument.astro', import.meta.url),
  'utf8',
)
const jsonLdSource = readFileSync(
  new URL('../components/MachineReadableMetadata.astro', import.meta.url),
  'utf8',
)
const catchAllSource = readFileSync(
  new URL('../pages/[...path].astro', import.meta.url),
  'utf8',
)
const spaPathsSource = readFileSync(
  new URL('../spaPaths.mjs', import.meta.url),
  'utf8',
)

const BRAND_SLOTS = [
  'description',
  'favicon',
  'apple-touch',
  'app-title',
  'og-title',
  'og-description',
  'og-image',
  'title',
  'json',
] as const

describe('SpaDocument SEO slots', () => {
  it('keeps every first-byte brand slot the stamper paints', () => {
    const slots = new Set(
      [...documentSource.matchAll(/data-myriad-brand="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    )
    assert.deepEqual([...slots].toSorted(), [...BRAND_SLOTS].toSorted())
    assert.match(documentSource, /id="meta-description"/)
    assert.match(documentSource, /id="myriad-site-brand"/)
    assert.match(documentSource, /property="og:image"/)
    assert.match(documentSource, /MachineReadableMetadata/)
    assert.match(jsonLdSource, /data-myriad-brand="json-ld"/)
    assert.match(jsonLdSource, /application\/ld\+json/)
    assert.match(jsonLdSource, /WebApplication/)
  })

  it('keeps locale, noscript, and crawler SPA-query stripping on the document', () => {
    assert.match(documentSource, /<LocaleLang/)
    assert.match(documentSource, /<StripSpaQuery/)
    assert.match(documentSource, /<NoScriptFallback/)
    assert.match(documentSource, /name="referrer"/)
    assert.match(documentSource, /<ThemeBoot/)
    assert.match(documentSource, /<DocumentRuntimeBoot/)
    assert.match(documentSource, /spa-document\.css/)
    assert.match(documentSource, /SITE_FONTS/)
    assert.doesNotMatch(documentSource, /is:global/)
    assert.doesNotMatch(documentSource, /pet-walker|platform-link|nav-container/)
  })

  it('still lists the human SPA paths that backend SEO shells share', () => {
    assert.match(catchAllSource, /export function getStaticPaths/)
    assert.match(catchAllSource, /spaPrerenderPaths/)
    for (const route of [
      'library',
      'reports',
      'tapp',
      'tapp/store',
      'tapp/run',
      'journal',
    ]) {
      assert.match(spaPathsSource, new RegExp(`'${route}'`))
    }
  })
})
