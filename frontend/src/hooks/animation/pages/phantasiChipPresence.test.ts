import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import {
  awaitLaneSwap,
  PHANTASI_CARD_EXIT_TRANSFORM,
  PHANTASI_SURFACE_CARD_CAP,
  PHANTASI_SURFACE_CARD_SELECTOR,
  PHANTASI_TAG_EXIT_TRANSFORM,
  PHANTASI_TAG_SWAP_PAD_MS,
  phantasiSurfaceSwapWait,
  phantasiTagSwapWait,
  chipExitFrames,
  collectPhantasiSurfaceNodes,
  planChipLaneSwap,
} from './phantasiChipPresence.ts'
import { PHANTASI_TAG_EXIT_MS, phantasiTagDelay } from './phantasiTag.ts'

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
    assert.equal(frames[1]?.transform, PHANTASI_TAG_EXIT_TRANSFORM)
  })

  it('卡片可换成不带缩放的落点', () => {
    const frames = chipExitFrames('1', 'none', PHANTASI_CARD_EXIT_TRANSFORM)
    assert.equal(frames[1]?.transform, PHANTASI_CARD_EXIT_TRANSFORM)
  })
})

describe('phantasiTagSwapWait', () => {
  it('等最后一枚退完', () => {
    assert.equal(PHANTASI_TAG_EXIT_MS, 220)
    assert.equal(
      phantasiTagSwapWait(3),
      phantasiTagDelay(2) + PHANTASI_TAG_EXIT_MS + PHANTASI_TAG_SWAP_PAD_MS,
    )
  })

  it('降级立刻切', () => {
    assert.equal(phantasiTagSwapWait(4, true), 0)
  })
})

describe('awaitLaneSwap', () => {
  it('finished 立刻回来也要满拍', async () => {
    const started = Date.now()
    await awaitLaneSwap(Promise.resolve(), 40)
    assert.ok(Date.now() - started >= 35)
  })
})

describe('PHANTASI_SURFACE_CARD_SELECTOR', () => {
  it('标题、空占位、网站卡、任意文章卡同一套', () => {
    assert.match(PHANTASI_SURFACE_CARD_SELECTOR, /data-phantasi-surface/)
    assert.match(PHANTASI_SURFACE_CARD_SELECTOR, /phantasi-rail-title/)
    assert.match(PHANTASI_SURFACE_CARD_SELECTOR, /\.phantasi-story/)
    assert.match(PHANTASI_SURFACE_CARD_SELECTOR, /\.phantasi-site/)
    assert.match(PHANTASI_SURFACE_CARD_SELECTOR, /phantasi-vacant/)
    assert.doesNotMatch(PHANTASI_SURFACE_CARD_SELECTOR, /phantasi-empty/)
  })
})

describe('collectPhantasiSurfaceNodes', () => {
  it('空占位里的标题不单独再退', () => {
    const { JSDOM } = require(
      require.resolve('jsdom', {
        paths: [require.resolve('isomorphic-dompurify')],
      }),
    ) as { JSDOM: new (html?: string) => { window: { document: Document } } }
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    const root = dom.window.document.createElement('div')
    root.innerHTML = `
      <div class="phantasi-rail-title" data-phantasi-surface="title"></div>
      <div class="phantasi-vacant" data-phantasi-surface="vacant">
        <div class="phantasi-rail-title"></div>
      </div>
      <div class="phantasi-site" data-phantasi-surface="site"></div>
      <div class="phantasi-story" data-phantasi-surface="story"></div>
    `
    const nodes = collectPhantasiSurfaceNodes(root)
    assert.equal(nodes.length, 4)
    assert.deepEqual(
      nodes.map((el) => el.dataset.phantasiSurface ?? el.className),
      ['title', 'vacant', 'site', 'story'],
    )
  })
})

describe('phantasiSurfaceSwapWait', () => {
  it('卡片多时以封顶错开为准', () => {
    assert.equal(phantasiSurfaceSwapWait(20), phantasiTagSwapWait(PHANTASI_SURFACE_CARD_CAP))
  })

  it('卡片少时按实际张数等', () => {
    assert.equal(phantasiSurfaceSwapWait(2), phantasiTagSwapWait(2))
  })
})
