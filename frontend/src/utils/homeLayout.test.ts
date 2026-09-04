import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  cloneHomeWidgets,
  effectiveHomeLayoutMode,
  estimateFreeHomeHostSize,
  HOME_FREE_PAGE_PAD_Y_REM,
  HOME_LAYOUT_MODE_KEY,
  HOME_PAGE_PAD_X_STEPS,
  HOME_STANDARD_COLS,
  HOME_STANDARD_MAX_WIDTH_REM,
  HOME_STANDARD_ROWS,
  HOME_STANDARD_STAGE_PAD_REM,
  homeFreePagePadYPx,
  homePagePaddingX,
  homePagePadXRem,
  homeStagePadPx,
  packWidgetsIntoColumns,
  parseDashboardLayout,
  parseDashboardLayoutJson,
  persistHomeLayoutMode,
  readHomeLayoutMode,
  resolveFreeHomeGrid,
  serializeDashboardLayout,
  standardHomeCellSize,
  standardHomeGridWidth,
} from './homeLayout'

const sample = [
  {
    id: 'w1',
    type: 'welcome',
    size: '4x2' as const,
    position: { x: 0, y: 0 },
  },
]

describe('homePagePaddingX', () => {
  it('follows the rem steps at 16px root', () => {
    assert.equal(homePagePadXRem(374), 0.75)
    assert.equal(homePagePadXRem(375), 1)
    assert.equal(homePagePadXRem(639), 1)
    assert.equal(homePagePadXRem(640), 1.5)
    assert.equal(homePagePaddingX(374), 12)
    assert.equal(homePagePaddingX(375), 16)
    assert.equal(homePagePaddingX(639), 16)
    assert.equal(homePagePaddingX(640), 24)
  })

  it('scales with root font size', () => {
    assert.equal(homePagePaddingX(640, 20), 30)
    assert.equal(homeStagePadPx(20), HOME_STANDARD_STAGE_PAD_REM * 2 * 20)
    assert.equal(homeFreePagePadYPx(20), HOME_FREE_PAGE_PAD_Y_REM * 2 * 20)
  })
})

describe('standardHomeCellSize', () => {
  it('caps the stage at 80rem so a wide desktop keeps the 16-col cell', () => {
    const wide = standardHomeGridWidth(1920)
    const stillCapped = standardHomeGridWidth(1400)
    assert.equal(wide, stillCapped)
    assert.equal(wide, 1280 - homeStagePadPx())
    assert.equal(standardHomeCellSize(1920), wide / HOME_STANDARD_COLS)
  })

  it('shrinks with the viewport below max-w-7xl', () => {
    const cellAtCap = standardHomeCellSize(1920)
    const cellNarrow = standardHomeCellSize(1100)
    assert.ok(cellNarrow < cellAtCap)
    assert.equal(
      standardHomeCellSize(1100),
      standardHomeGridWidth(1100) / HOME_STANDARD_COLS,
    )
  })
})

describe('estimateFreeHomeHostSize', () => {
  it('subtracts page pad-x, stage pad, and free pad-y', () => {
    const size = estimateFreeHomeHostSize(1920, 1080)
    assert.equal(
      size.width,
      1920 - homePagePaddingX(1920) * 2 - homeStagePadPx(),
    )
    assert.equal(
      size.height,
      1080 - homeFreePagePadYPx() - homeStagePadPx(),
    )
    assert.ok(size.width > 0)
    assert.ok(size.height > 0)
  })
})

describe('resolveFreeHomeGrid', () => {
  it('keeps at least the standard 16×4 and grows by whole cells', () => {
    const cell = 79
    const grid = resolveFreeHomeGrid({
      availableWidth: 1840,
      availableHeight: 900,
      cellSize: cell,
    })
    assert.equal(grid.cell, cell)
    assert.equal(grid.cols, Math.floor(1840 / cell))
    assert.equal(grid.rows, Math.floor(900 / cell))
    assert.ok(grid.cols >= HOME_STANDARD_COLS)
    assert.ok(grid.rows >= HOME_STANDARD_ROWS)
  })

  it('falls back to 16×4 when the host has not been measured', () => {
    const grid = resolveFreeHomeGrid({
      availableWidth: 0,
      availableHeight: 0,
      cellSize: 80,
    })
    assert.deepEqual(grid, {
      cols: HOME_STANDARD_COLS,
      rows: HOME_STANDARD_ROWS,
      cell: 80,
    })
  })
})

describe('parseDashboardLayout', () => {
  it('treats a legacy array as standard and copies it into free', () => {
    const parsed = parseDashboardLayout(sample)
    assert.equal(parsed.standard[0]?.id, 'w1')
    assert.equal(parsed.free[0]?.id, 'w1')
    assert.notEqual(parsed.free, parsed.standard)
    parsed.free[0].position.x = 9
    assert.equal(parsed.standard[0].position.x, 0)
  })

  it('reads v2 envelopes and keeps an explicit empty free list', () => {
    const parsed = parseDashboardLayout({
      v: 2,
      standard: sample,
      free: [],
    })
    assert.equal(parsed.standard.length, 1)
    assert.equal(parsed.free.length, 0)
  })

  it('clones standard when free is missing', () => {
    const parsed = parseDashboardLayout({ v: 2, standard: sample })
    assert.equal(parsed.free.length, 1)
    assert.equal(parsed.free[0]?.id, 'w1')
  })

  it('round-trips through JSON', () => {
    const layouts = {
      standard: sample,
      free: cloneHomeWidgets(sample),
    }
    layouts.free[0].position = { x: 4, y: 1 }
    const parsed = parseDashboardLayoutJson(serializeDashboardLayout(layouts))
    assert.equal(parsed.standard[0]?.position.x, 0)
    assert.equal(parsed.free[0]?.position.x, 4)
  })

  it('returns empty layouts for invalid JSON', () => {
    assert.deepEqual(parseDashboardLayoutJson('not-json'), {
      standard: [],
      free: [],
    })
  })
})

function widget(
  id: string,
  size: '2x2' | '2x4' | '4x2' | '4x4',
  x: number,
  y: number,
) {
  return { id, type: id, size, position: { x, y } }
}

describe('packWidgetsIntoColumns', () => {
  it('keeps later source rows below earlier ones', () => {
    const source = [
      widget('a', '2x2', 10, 3),
      widget('b', '2x2', 0, 0),
      widget('c', '4x2', 4, 0),
    ]
    const packed = packWidgetsIntoColumns(source, 4)
    assert.deepEqual(
      packed.widgets.map((w) => [w.id, w.position.x, w.position.y]),
      [
        ['b', 0, 0],
        ['c', 0, 2],
        ['a', 0, 4],
      ],
    )
    assert.equal(packed.height, 6)
    assert.equal(source[0].position.x, 10)
  })

  it('fills beside a tall widget in the same visual row', () => {
    const packed = packWidgetsIntoColumns(
      [widget('tall', '2x4', 0, 0), widget('side', '2x2', 4, 0)],
      4,
    )
    assert.deepEqual(
      packed.widgets.map((w) => [w.id, w.position.x, w.position.y]),
      [
        ['tall', 0, 0],
        ['side', 2, 0],
      ],
    )
    assert.equal(packed.height, 4)
  })

  it('does not pull a lower-row widget into an upper-row hole', () => {
    const packed = packWidgetsIntoColumns(
      [widget('top', '2x2', 0, 0), widget('low', '2x2', 8, 6)],
      4,
    )
    assert.deepEqual(
      packed.widgets.map((w) => [w.id, w.position.x, w.position.y]),
      [
        ['top', 0, 0],
        ['low', 0, 2],
      ],
    )
  })

  it('treats staggered tops one cell apart as the same row', () => {
    const packed = packWidgetsIntoColumns(
      [widget('left', '2x2', 0, 0), widget('right', '2x2', 4, 1)],
      4,
    )
    assert.deepEqual(
      packed.widgets.map((w) => [w.id, w.position.x, w.position.y]),
      [
        ['left', 0, 0],
        ['right', 2, 0],
      ],
    )
  })

  it('clamps a widget wider than the column count', () => {
    const packed = packWidgetsIntoColumns([widget('wide', '4x2', 8, 1)], 2)
    assert.equal(packed.widgets[0]?.position.x, 0)
    assert.equal(packed.widgets[0]?.position.y, 0)
    assert.equal(packed.height, 4)
  })

  it('returns empty packing for no widgets', () => {
    const packed = packWidgetsIntoColumns([], 16)
    assert.deepEqual(packed.widgets, [])
    assert.equal(packed.height, HOME_STANDARD_ROWS)
  })
})

describe('home layout mode storage', () => {
  it('defaults to standard and only accepts free', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    assert.equal(readHomeLayoutMode(storage), 'standard')
    persistHomeLayoutMode('free', storage)
    assert.equal(store.get(HOME_LAYOUT_MODE_KEY), 'free')
    assert.equal(readHomeLayoutMode(storage), 'free')
    persistHomeLayoutMode('standard', storage)
    assert.equal(readHomeLayoutMode(storage), 'standard')
  })

  it('stays standard on phone / tablet', () => {
    assert.equal(effectiveHomeLayoutMode('free', false), 'standard')
    assert.equal(effectiveHomeLayoutMode('free', true), 'free')
  })
})

describe('home shell CSS contract', () => {
  it('keeps Home.css --home-* in lockstep with the rem steps', () => {
    const css = readFileSync(new URL('../views/Home.css', import.meta.url), 'utf8')
    const home = readFileSync(new URL('../views/Home.tsx', import.meta.url), 'utf8')
    assert.equal(HOME_PAGE_PAD_X_STEPS[0]?.rem, 0.75)
    assert.equal(HOME_PAGE_PAD_X_STEPS[1]?.minWidth, 375)
    assert.equal(HOME_PAGE_PAD_X_STEPS[1]?.rem, 1)
    assert.equal(HOME_PAGE_PAD_X_STEPS[2]?.minWidth, 640)
    assert.equal(HOME_PAGE_PAD_X_STEPS[2]?.rem, 1.5)
    assert.match(css, /--home-page-pad-x:\s*0\.75rem/)
    assert.match(css, /width\s*>=\s*375px/)
    assert.match(css, /--home-page-pad-x:\s*1rem/)
    assert.match(css, /width\s*>=\s*640px/)
    assert.match(css, /--home-page-pad-x:\s*1\.5rem/)
    assert.match(
      css,
      new RegExp(`--home-stage-pad:\\s*${HOME_STANDARD_STAGE_PAD_REM}rem`),
    )
    assert.match(
      css,
      new RegExp(`--home-free-pad-y:\\s*${HOME_FREE_PAGE_PAD_Y_REM}rem`),
    )
    assert.match(
      css,
      new RegExp(
        `--home-standard-max-width:\\s*${HOME_STANDARD_MAX_WIDTH_REM}rem`,
      ),
    )
    assert.equal(home.includes('px-3 xs:px-4 sm:px-6'), false)
    assert.equal(home.includes('max-w-7xl'), false)
    assert.equal(/py-6/.test(home), false)
  })
})
