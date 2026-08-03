import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  sanitizeSiteFaviconUrl,
  sanitizeSiteOgImageUrl,
  sanitizeUmamiScriptUrl,
} from './configUrlPolicy'

describe('configUrlPolicy (soft — keep normal usage)', () => {
  it('favicon allows path, public, LAN, data:image', () => {
    assert.equal(sanitizeSiteFaviconUrl('/favicon.webp'), '/favicon.webp')
    assert.equal(
      sanitizeSiteFaviconUrl('https://cdn.example.com/i.png'),
      'https://cdn.example.com/i.png',
    )
    assert.equal(
      sanitizeSiteFaviconUrl('http://192.168.1.5/logo.png'),
      'http://192.168.1.5/logo.png',
    )
    assert.ok(
      sanitizeSiteFaviconUrl('data:image/png;base64,aaa')?.startsWith(
        'data:image/png',
      ),
    )
    assert.equal(sanitizeSiteFaviconUrl(''), '')
  })

  it('favicon rejects dangerous schemes', () => {
    assert.equal(sanitizeSiteFaviconUrl('javascript:alert(1)'), null)
    assert.equal(sanitizeSiteFaviconUrl('data:text/html,<svg>'), null)
    assert.equal(sanitizeSiteFaviconUrl('/javascript:alert(1)'), null)
  })

  it('og image allows path/http, rejects data', () => {
    assert.equal(sanitizeSiteOgImageUrl('/og.png'), '/og.png')
    assert.equal(sanitizeSiteOgImageUrl('data:image/png;base64,x'), null)
  })

  it('umami allows LAN self-host, rejects javascript', () => {
    assert.equal(
      sanitizeUmamiScriptUrl('http://10.0.0.2:3000/script.js'),
      'http://10.0.0.2:3000/script.js',
    )
    assert.equal(sanitizeUmamiScriptUrl('javascript:x'), null)
  })
})
