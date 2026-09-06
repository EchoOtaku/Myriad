import type { TourDefinition } from './tourTypes'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeTourCardPosition,
  filterVisibleSteps,
  firstVisibleIndex,
  holePadForBox,
  inflateRect,
  isDegenerateBox,
  normalizeTourPath,
  pickLargestVisible,
  pickTour,
  previousVisibleIndex,
  TOUR_HOLE_PAD,
  unionBoxes,
} from './tourLogic'
import {
  CONFIG_TOURS,
  HOME_TOURS,
  LIBRARY_TOURS,
  REPORTS_TOURS,
  TAPP_STORE_TOURS,
  TAPP_TOURS,
  TOURS,
} from './tourRegistry'

describe('inflateRect', () => {
  it('pads every edge', () => {
    const next = inflateRect({ top: 40, left: 20, width: 100, height: 50 }, 8)
    assert.deepEqual(next, {
      top: 32,
      left: 12,
      width: 116,
      height: 66,
      right: 128,
      bottom: 98,
    })
  })

  it('uses TOUR_HOLE_PAD by default', () => {
    const next = inflateRect({ top: 10, left: 10, width: 10, height: 10 })
    assert.equal(next.width, 10 + TOUR_HOLE_PAD * 2)
  })
})

describe('filterVisibleSteps', () => {
  it('drops missing anchors', () => {
    const present = new Set(['nav', 'home-grid'])
    const next = filterVisibleSteps(
      [
        { id: 'nav', anchor: 'nav' },
        { id: 'edit', anchor: 'home-edit' },
        { id: 'grid', anchor: 'home-grid' },
      ],
      (anchor) => present.has(anchor),
    )
    assert.deepEqual(
      next.map((step) => step.id),
      ['nav', 'grid'],
    )
  })
})

describe('visible index walk', () => {
  const steps = [
    { id: 'a', anchor: 'a' },
    { id: 'b', anchor: 'b' },
    { id: 'c', anchor: 'c' },
  ]
  const has = (anchor: string) => anchor !== 'b'

  it('skips missing when walking forward', () => {
    assert.equal(firstVisibleIndex(steps, has, 1), 2)
  })

  it('skips missing when walking back', () => {
    assert.equal(previousVisibleIndex(steps, has, 2), 0)
  })

  it('returns -1 when nothing remains', () => {
    assert.equal(
      firstVisibleIndex(steps, () => false, 0),
      -1,
    )
  })
})

describe('normalizeTourPath', () => {
  it('keeps root', () => {
    assert.equal(normalizeTourPath('/'), '/')
  })

  it('strips trailing slashes', () => {
    assert.equal(normalizeTourPath('/library/'), '/library')
  })
})

describe('pickTour', () => {
  it('selects visitor home tour', () => {
    const tour = pickTour(HOME_TOURS, '/', false)
    assert.equal(tour?.id, 'home-visitor')
    assert.deepEqual(
      tour?.steps.map((step) => step.anchor),
      ['nav', 'home-grid'],
    )
  })

  it('selects owner home tour', () => {
    const tour = pickTour(HOME_TOURS, '/', true)
    assert.equal(tour?.id, 'home-owner')
    assert.equal(tour?.steps.at(-1)?.anchor, 'control-island')
  })

  it('returns null when the page has no tour', () => {
    assert.equal(pickTour(HOME_TOURS, '/library', true), null)
  })
})

describe('HOME_TOURS', () => {
  it('keeps owner and visitor as separate definitions', () => {
    const ids = HOME_TOURS.map((tour: TourDefinition) => tour.id)
    assert.deepEqual(ids, ['home-visitor', 'home-owner'])
  })
})

describe('page tours', () => {
  it('registers library, reports, tapp, store, and owner-only config', () => {
    assert.equal(pickTour(LIBRARY_TOURS, '/library', false)?.id, 'library-visitor')
    assert.equal(pickTour(REPORTS_TOURS, '/reports', true)?.id, 'reports-owner')
    assert.equal(pickTour(TAPP_TOURS, '/tapp', false)?.id, 'tapp-visitor')
    assert.equal(
      pickTour(TAPP_STORE_TOURS, '/tapp/store', true)?.id,
      'tapp-store-owner',
    )
    assert.equal(pickTour(CONFIG_TOURS, '/config', true)?.id, 'config-owner')
    assert.equal(pickTour(CONFIG_TOURS, '/config', false), null)
  })

  it('does not register brew reading routes', () => {
    assert.equal(pickTour(TOURS, '/brew', true), null)
    assert.equal(pickTour(TOURS, '/brew/item/1', true), null)
  })

  it('keeps owner chrome last on module pages', () => {
    assert.equal(
      pickTour(LIBRARY_TOURS, '/library', true)?.steps.at(-1)?.anchor,
      'control-island',
    )
    assert.deepEqual(
      pickTour(TAPP_TOURS, '/tapp', false)?.steps.map((step) => step.anchor),
      ['nav', 'tapp-toolbar', 'tapp-grid'],
    )
  })
})

describe('unionBoxes', () => {
  it('wraps every widget rect', () => {
    const union = unionBoxes([
      { top: 200, left: 80, width: 200, height: 160 },
      { top: 200, left: 300, width: 400, height: 200 },
      { top: 380, left: 80, width: 200, height: 120 },
    ])
    assert.deepEqual(union, {
      top: 200,
      left: 80,
      width: 620,
      height: 300,
    })
  })

  it('ignores empty rects', () => {
    assert.equal(
      unionBoxes([{ top: 0, left: 0, width: 0, height: 10 }]),
      null,
    )
  })
})

describe('pickLargestVisible', () => {
  it('prefers the on-screen grid over a clipped right-edge sliver', () => {
    const panel = { id: 'panel', top: 80, left: 1200, width: 320, height: 200 }
    const home = { id: 'home', top: 220, left: 80, width: 1100, height: 480 }
    const picked = pickLargestVisible(
      [panel, home],
      (item) => item,
      1280,
      800,
    )
    assert.equal(picked?.id, 'home')
  })
})

describe('isDegenerateBox', () => {
  it('rejects a sliver', () => {
    assert.equal(
      isDegenerateBox({ top: 0, left: 1200, width: 8, height: 400 }),
      true,
    )
  })
})

describe('holePadForBox', () => {
  it('uses a tighter pad on large surfaces', () => {
    assert.equal(
      holePadForBox({ top: 0, left: 0, width: 900, height: 400 }),
      6,
    )
  })

  it('uses a looser pad on small chrome', () => {
    assert.equal(
      holePadForBox({ top: 0, left: 0, width: 40, height: 32 }),
      10,
    )
  })
})

describe('computeTourCardPosition', () => {
  it('puts the card to the right of a tall left rail, centered', () => {
    const hole = {
      top: 200,
      left: 16,
      width: 56,
      height: 400,
      right: 72,
      bottom: 600,
    }
    const pos = computeTourCardPosition(hole, 300, 160, 1280, 800)
    assert.equal(pos.placement, 'right')
    assert.equal(pos.left, 72 + 14)
    assert.ok(pos.top > 200 && pos.top + 160 < 600)
  })

  it('puts the card above a wide bottom bar, centered', () => {
    const hole = {
      top: 740,
      left: 400,
      width: 480,
      height: 48,
      right: 880,
      bottom: 788,
    }
    const pos = computeTourCardPosition(hole, 300, 160, 1280, 800)
    assert.equal(pos.placement, 'top')
    assert.equal(pos.top + 160 + 14, 740)
    const cardMid = pos.left + 150
    const holeMid = 400 + 240
    assert.ok(Math.abs(cardMid - holeMid) < 1)
  })

  it('puts the card to the left of a top-right island', () => {
    const hole = {
      top: 16,
      left: 1100,
      width: 160,
      height: 48,
      right: 1260,
      bottom: 64,
    }
    const pos = computeTourCardPosition(hole, 300, 160, 1280, 800)
    assert.equal(pos.placement, 'left')
    assert.ok(pos.left + 300 <= 1100)
    assert.ok(pos.top >= 16)
  })

  it('docks a near-full grid card to the bottom of the viewport', () => {
    const hole = {
      top: 80,
      left: 80,
      width: 1120,
      height: 640,
      right: 1200,
      bottom: 720,
    }
    const pos = computeTourCardPosition(hole, 300, 160, 1280, 800)
    assert.equal(pos.placement, 'dock')
    assert.ok(pos.top + 160 <= 800)
    assert.ok(Math.abs(pos.left + 150 - 640) < 1)
  })

  it('aims the caret at the hole center on a side placement', () => {
    const hole = {
      top: 200,
      left: 16,
      width: 56,
      height: 400,
      right: 72,
      bottom: 600,
    }
    const pos = computeTourCardPosition(hole, 300, 160, 1280, 800)
    assert.equal(pos.placement, 'right')
    const holeCy = 400
    assert.ok(Math.abs(pos.top + pos.caret - holeCy) < 1)
  })
})
