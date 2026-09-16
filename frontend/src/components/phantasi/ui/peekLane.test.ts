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
  notePeekPointer,
  peekGoesToNav,
  peekLaneIsLive,
  peekLaneKeepsAir,
  peekLaneIsSwapping,
  peekPointerMoving,
  peekPointerWantsAir,
  peekPreviewFromStory,
  peekSwapHoldsAir,
  resetPeekPointer,
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
    const friends = readFileSync(join(dir, '../skin/PhantasiFriends.tsx'), 'utf8')
    assert.match(card, /usePhantasiPeekLane/)
    assert.match(card, /peekLaneKeepsAir/)
    assert.match(card, /resumePhantasiStoryPeek/)
    assert.match(list, /usePhantasiPeekLane/)
    assert.match(list, /data-phantasi-peek-lane/)
    assert.match(notes, /usePhantasiPeekLane/)
    assert.match(notes, /data-phantasi-peek-lane/)
    assert.match(friends, /usePhantasiPeekLane/)
    assert.match(friends, /data-phantasi-peek-lane/)
  })
})

describe('peekSwapHoldsAir', () => {
  it('换页退场、inert、节点卸掉时按住壁纸', () => {
    phantasiMotionReset()
    resetPeekPointer()
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
    assert.equal(peekSwapHoldsAir(gone), false)
    gone?.remove()
    assert.equal(peekSwapHoldsAir(gone), true)
    assert.equal(peekLaneIsSwapping(live), false)

    const lane = phantasiMotionClaim('lane')
    assert.equal(peekLaneIsSwapping(live), true)
    phantasiMotionRelease(lane)
    assert.equal(peekLaneIsSwapping(live), false)
  })

  it('去向导航或退场轨不发结束，进场活轨才算活', () => {
    resetPeekPointer()
    const nav = new JSDOM(
      `<div class="nav-container"><button class="nav-item" id="notes">笔记</button></div>
       <div class="phantasi-view-lane" data-chip-phase="enter">
         <div data-phantasi-peek-lane id="lane"><button class="phantasi-story" id="s"></button></div>
       </div>
       <div class="phantasi-view-lane" data-chip-phase="exit" inert>
         <div data-phantasi-peek-lane id="dead"><button class="phantasi-story" id="old"></button></div>
       </div>`,
    ).window.document
    assert.equal(peekGoesToNav(nav.getElementById('notes')), true)
    assert.equal(peekLaneIsLive(nav.getElementById('lane')), true)
    assert.equal(peekLaneIsLive(nav.getElementById('dead')), false)
    assert.equal(peekSwapHoldsAir(nav.getElementById('old')), true)
    assert.equal(peekSwapHoldsAir(nav.getElementById('s')), false)
  })

  it('指针还在走或停在导航、文章卡上时按住，停在空白才退', () => {
    resetPeekPointer()
    const page = new JSDOM(
      `<div class="nav-container"><button class="nav-item" id="notes">笔记</button></div>
       <div data-phantasi-peek-lane>
         <button class="phantasi-story" id="s"></button>
       </div>
       <div id="empty">空白</div>`,
    ).window.document
    assert.equal(peekGoesToNav(page.getElementById('notes')), true)
    assert.equal(peekGoesToNav(page.getElementById('s')), false)
    assert.equal(peekGoesToNav(page.getElementById('empty')), false)
    assert.equal(peekGoesToNav(null), false)
    notePeekPointer({ clientX: 12, clientY: 8 })
    assert.equal(peekPointerMoving(), true)
    assert.equal(peekPointerWantsAir(), true)
    resetPeekPointer()
    assert.equal(peekPointerMoving(), false)
    assert.equal(peekPointerWantsAir(), false)
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
