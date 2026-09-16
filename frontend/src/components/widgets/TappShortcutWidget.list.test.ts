import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('TappShortcutWidget catalog load', () => {
  it('resolves a tile from listTapps themeColor, not /tapps/details manifests', () => {
    const src = readFileSync(join(dir, 'TappShortcutWidget.tsx'), 'utf8')
    assert.match(src, /listTapps\(\)/)
    assert.match(src, /themeColor: found\.themeColor/)
    assert.doesNotMatch(src, /listTappDetails/)
  })
})
