import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { peekLaneKeepsAir } from './peekLane.ts'

const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)
const dir = dirname(fileURLToPath(import.meta.url))

describe('peekLaneKeepsAir', () => {
  it('还在宫格或文章轨里换卡，不退壁纸', () => {
    const grid = new JSDOM(
      `<div data-brew-peek-lane>
        <button class="brew-story" id="a"></button>
        <button class="brew-story" id="b"></button>
      </div>`,
    ).window.document
    const a = grid.getElementById('a')
    const b = grid.getElementById('b')
    assert.equal(peekLaneKeepsAir(a, b), true)
    assert.equal(peekLaneKeepsAir(a, grid.body), false)

    const rail = new JSDOM(
      `<div data-brew-rail-track="items">
        <button class="brew-story" id="c"></button>
        <button class="brew-story" id="d"></button>
      </div>`,
    ).window.document
    assert.equal(
      peekLaneKeepsAir(rail.getElementById('c'), rail.getElementById('d')),
      true,
    )
  })

  it('收藏宫格和手记文章卡都标了 peek 区', () => {
    const card = readFileSync(join(dir, 'StoryCard.tsx'), 'utf8')
    const notes = readFileSync(join(dir, '../skin/BrewNotes.tsx'), 'utf8')
    assert.match(card, /peekLaneKeepsAir/)
    assert.match(card, /data-brew-peek-lane/)
    assert.match(notes, /data-brew-peek-lane/)
  })
})
