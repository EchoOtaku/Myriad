import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('FriendLinksWidget source load', () => {
  it('asks for catalog sources instead of preview/pulse overlay', () => {
    const src = readFileSync(join(dir, 'FriendLinksWidget.tsx'), 'utf8')
    assert.match(src, /getSources\(undefined, \{ view: 'catalog' \}\)/)
    assert.doesNotMatch(src, /recent_items|pulses/)
  })
})
