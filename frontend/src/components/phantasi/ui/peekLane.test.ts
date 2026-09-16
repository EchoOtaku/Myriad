import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  phantasiMotionClaim,
  phantasiMotionRelease,
  phantasiMotionReset,
} from '../../../hooks/animation/pages/phantasiMotion.ts'
import {
  peekLaneKeepsAir,
  peekLaneIsSwapping,
  peekPreviewFromStory,
  peekSwapHoldsAir,
} from './peekLane.ts'

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
    assert.equal(peekLaneKeepsAir(a, grid.querySelector('[data-phantasi-peek-lane]')), false)
    assert.equal(peekLaneKeepsAir(a, null), false)

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
    assert.equal(
      peekLaneKeepsAir(
        rail.getElementById('c'),
        rail.querySelector('[data-phantasi-rail-track="items"]'),
      ),
      false,
    )

    const slot = new JSDOM(
      `<div data-phantasi-peek-lane>
        <button class="phantasi-story" id="live"></button>
        <button class="phantasi-story phantasi-story--slot" id="empty"></button>
      </div>`,
    ).window.document
    assert.equal(
      peekLaneKeepsAir(slot.getElementById('live'), slot.getElementById('empty')),
      false,
    )
  })

  it('收藏宫格和笔记文章卡都标了 peek 区', () => {
    const card = readFileSync(join(dir, 'StoryCard.tsx'), 'utf8')
    const list = readFileSync(join(dir, '../skin/PhantasiList.tsx'), 'utf8')
    const notes = readFileSync(join(dir, '../skin/PhantasiNotes.tsx'), 'utf8')
    assert.match(card, /peekLaneKeepsAir/)
    assert.match(card, /resumePhantasiStoryPeek/)
    assert.match(list, /data-phantasi-peek-lane/)
    assert.match(notes, /data-phantasi-peek-lane/)
  })
})

describe('peekSwapHoldsAir', () => {
  it('换页退场、inert、节点卸掉时按住壁纸', () => {
    phantasiMotionReset()
    const exiting = new JSDOM(
      `<div class="phantasi-view-lane" data-chip-phase="exit">
        <button class="phantasi-story" id="a"></button>
      </div>`,
    ).window.document
    assert.equal(peekSwapHoldsAir(exiting.getElementById('a')), true)
    assert.equal(peekLaneIsSwapping(exiting), true)

    const frozen = new JSDOM(
      `<div class="phantasi-view-lane" inert>
        <button class="phantasi-story" id="b"></button>
      </div>`,
    ).window.document
    assert.equal(peekSwapHoldsAir(frozen.getElementById('b')), true)

    const live = new JSDOM(
      `<div class="phantasi-view-lane" data-chip-phase="enter">
        <button class="phantasi-story" id="c"></button>
      </div>`,
    ).window.document
    const gone = live.getElementById('c')
    gone?.remove()
    assert.equal(peekSwapHoldsAir(gone), true)
    assert.equal(peekLaneIsSwapping(live), false)

    const lane = phantasiMotionClaim('lane')
    assert.equal(peekLaneIsSwapping(live), true)
    phantasiMotionRelease(lane)
    assert.equal(peekLaneIsSwapping(live), false)
  })
})

describe('peekPreviewFromStory', () => {
  it('从卡片 DOM 读回封面预览', () => {
    const page = new JSDOM(
      `<button class="phantasi-story" data-rail-id="12">
        <span class="phantasi-story__title">Rust 周报</span>
        <span class="phantasi-story__source">
          <img data-src="/icon.png" alt="">
          <span>源站</span>
        </span>
        <span class="phantasi-story__thumb" data-src="/cover.jpg"></span>
      </button>`,
    ).window.document
    const node = page.querySelector('.phantasi-story') as HTMLElement
    assert.ok(node)
    assert.deepEqual(peekPreviewFromStory(node), {
      id: 12,
      title: 'Rust 周报',
      image: '/cover.jpg',
      source_name: '源站',
      source_icon: '/icon.png',
    })
  })
})
