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
      `<div data-phantasi-peek-lane>
        <button class="phantasi-story" id="a"></button>
        <button class="phantasi-story" id="b"></button>
      </div>`,
    ).window.document
    const a = grid.getElementById('a')
    const b = grid.getElementById('b')
    assert.equal(peekLaneKeepsAir(a, b), true)
    assert.equal(peekLaneKeepsAir(a, grid.body), false)

    const rail = new JSDOM(
      `<div data-phantasi-rail-track="items">
        <button class="phantasi-story" id="c"></button>
        <button class="phantasi-story" id="d"></button>
      </div>`,
    ).window.document
    assert.equal(
      peekLaneKeepsAir(rail.getElementById('c'), rail.getElementById('d')),
      true,
    )
  })

  it('收藏宫格和笔记文章卡都标了 peek 区', () => {
    const card = readFileSync(join(dir, 'StoryCard.tsx'), 'utf8')
    const list = readFileSync(join(dir, '../skin/PhantasiList.tsx'), 'utf8')
    const notes = readFileSync(join(dir, '../skin/PhantasiNotes.tsx'), 'utf8')
    assert.match(card, /peekLaneKeepsAir/)
    assert.match(list, /data-phantasi-peek-lane/)
    assert.match(notes, /data-phantasi-peek-lane/)
  })
})
