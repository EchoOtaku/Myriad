import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import {
  awaitLaneSwap,
  BREW_CARD_EXIT_TRANSFORM,
  BREW_SURFACE_CARD_CAP,
  BREW_SURFACE_CARD_SELECTOR,
  BREW_TAG_EXIT_TRANSFORM,
  BREW_TAG_SWAP_PAD_MS,
  brewSurfaceSwapWait,
  brewTagSwapWait,
  chipExitFrames,
  collectBrewSurfaceNodes,
  planChipLaneSwap,
} from './brewChipPresence.ts'
import { BREW_TAG_EXIT_MS, brewTagDelay } from './brewTag.ts'

const require = createRequire(import.meta.url)

describe('planChipLaneSwap', () => {
  it('退场中只改目的地', () => {
    assert.equal(planChipLaneSwap('default', 'search', true), 'retarget')
    assert.equal(planChipLaneSwap('default', 'default', true), 'retarget')
  })

  it('同波次不重开', () => {
    assert.equal(planChipLaneSwap('search', 'search', false), 'hold')
  })

  it('换波次才开退场', () => {
    assert.equal(planChipLaneSwap('default', 'search', false), 'start-exit')
  })
})

describe('chipExitFrames', () => {
  it('从当前透明度退，不从 1 起笔', () => {
    const frames = chipExitFrames('0.4', 'none')
    assert.equal(frames[0]?.opacity, '0.4')
    assert.equal(frames[0]?.transform, 'none')
    assert.equal(frames[1]?.opacity, 0)
    assert.equal(frames[1]?.transform, BREW_TAG_EXIT_TRANSFORM)
  })

  it('卡片可换成不带缩放的落点', () => {
    const frames = chipExitFrames('1', 'none', BREW_CARD_EXIT_TRANSFORM)
    assert.equal(frames[1]?.transform, BREW_CARD_EXIT_TRANSFORM)
  })
})

describe('brewTagSwapWait', () => {
  it('等最后一枚退完', () => {
    assert.equal(BREW_TAG_EXIT_MS, 220)
    assert.equal(
      brewTagSwapWait(3),
      brewTagDelay(2) + BREW_TAG_EXIT_MS + BREW_TAG_SWAP_PAD_MS,
    )
  })

  it('降级立刻切', () => {
    assert.equal(brewTagSwapWait(4, true), 0)
  })
})

describe('awaitLaneSwap', () => {
  it('finished 立刻回来也要满拍', async () => {
    const started = Date.now()
    await awaitLaneSwap(Promise.resolve(), 40)
    assert.ok(Date.now() - started >= 35)
  })
})

describe('BREW_SURFACE_CARD_SELECTOR', () => {
  it('标题、空占位、网站卡、任意文章卡同一套', () => {
    assert.match(BREW_SURFACE_CARD_SELECTOR, /data-brew-surface/)
    assert.match(BREW_SURFACE_CARD_SELECTOR, /brew-rail-title/)
    assert.match(BREW_SURFACE_CARD_SELECTOR, /\.brew-story/)
    assert.match(BREW_SURFACE_CARD_SELECTOR, /\.brew-site/)
    assert.match(BREW_SURFACE_CARD_SELECTOR, /brew-vacant/)
    assert.doesNotMatch(BREW_SURFACE_CARD_SELECTOR, /brew-empty/)
  })
})

describe('collectBrewSurfaceNodes', () => {
  it('空占位里的标题不单独再退', () => {
    const { JSDOM } = require(
      require.resolve('jsdom', {
        paths: [require.resolve('isomorphic-dompurify')],
      }),
    ) as { JSDOM: new (html?: string) => { window: { document: Document } } }
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    const root = dom.window.document.createElement('div')
    root.innerHTML = `
      <div class="brew-rail-title" data-brew-surface="title"></div>
      <div class="brew-vacant" data-brew-surface="vacant">
        <div class="brew-rail-title"></div>
      </div>
      <div class="brew-site" data-brew-surface="site"></div>
      <div class="brew-story" data-brew-surface="story"></div>
    `
    const nodes = collectBrewSurfaceNodes(root)
    assert.equal(nodes.length, 4)
    assert.deepEqual(
      nodes.map((el) => el.dataset.brewSurface ?? el.className),
      ['title', 'vacant', 'site', 'story'],
    )
  })
})

describe('brewSurfaceSwapWait', () => {
  it('卡片多时以封顶错开为准', () => {
    assert.equal(brewSurfaceSwapWait(20), brewTagSwapWait(BREW_SURFACE_CARD_CAP))
  })

  it('卡片少时按实际张数等', () => {
    assert.equal(brewSurfaceSwapWait(2), brewTagSwapWait(2))
  })
})
