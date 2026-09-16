import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_WORKBENCH_RAIL_VISIBILITY,
  WORKBENCH_RAIL_MIN_VISIBLE,
  WORKBENCH_RAIL_OPTION_PANES,
  WORKBENCH_RAIL_STORAGE_KEY,
  normalizeWorkbenchRailVisibility,
  readWorkbenchRailVisibility,
  setWorkbenchRailPane,
  workbenchRailAllowsHide,
  workbenchRailShowsPane,
  workbenchRailVisibleCount,
  writeWorkbenchRailVisibility,
} from './workbenchVisibility.ts'

describe('workbenchRailVisibility', () => {
  it('缺字段或全关时至少打开两页', () => {
    assert.equal(
      workbenchRailVisibleCount(DEFAULT_WORKBENCH_RAIL_VISIBILITY),
      WORKBENCH_RAIL_OPTION_PANES.length,
    )
    const empty = normalizeWorkbenchRailVisibility({})
    assert.equal(workbenchRailVisibleCount(empty), WORKBENCH_RAIL_OPTION_PANES.length)
    const forced = normalizeWorkbenchRailVisibility({
      notes: false,
      comments: false,
      media: false,
      notesIo: false,
      sources: false,
      reviews: false,
      rsshub: false,
      feedsIo: false,
    })
    assert.equal(workbenchRailVisibleCount(forced), WORKBENCH_RAIL_MIN_VISIBLE)
    assert.equal(forced.notes, true)
    assert.equal(forced.comments, true)
  })

  it('只剩两页时不能再关', () => {
    const two = normalizeWorkbenchRailVisibility({
      notes: true,
      comments: true,
      media: false,
      notesIo: false,
      sources: false,
      reviews: false,
      rsshub: false,
      feedsIo: false,
    })
    assert.equal(workbenchRailVisibleCount(two), 2)
    assert.equal(workbenchRailAllowsHide(two, 'notes'), false)
    assert.deepEqual(setWorkbenchRailPane(two, 'notes', false), two)
    const three = setWorkbenchRailPane(two, 'media', true)
    assert.equal(workbenchRailAllowsHide(three, 'notes'), true)
    assert.equal(setWorkbenchRailPane(three, 'notes', false).notes, false)
  })

  it('概览常在；添加订阅跟订阅页走', () => {
    const vis = setWorkbenchRailPane(DEFAULT_WORKBENCH_RAIL_VISIBILITY, 'sources', false)
    assert.equal(workbenchRailShowsPane(vis, 'home'), true)
    assert.equal(workbenchRailShowsPane(vis, 'sources'), false)
    assert.equal(workbenchRailShowsPane(vis, 'add'), false)
    assert.equal(workbenchRailShowsPane(vis, 'topics'), false)
    assert.equal(workbenchRailShowsPane(vis, 'noteCategories'), true)
  })

  it('localStorage 读坏值不抛', () => {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    writeWorkbenchRailVisibility(
      setWorkbenchRailPane(DEFAULT_WORKBENCH_RAIL_VISIBILITY, 'rsshub', false),
    )
    assert.equal(readWorkbenchRailVisibility().rsshub, false)
    store.set(WORKBENCH_RAIL_STORAGE_KEY, '{')
    assert.deepEqual(readWorkbenchRailVisibility(), DEFAULT_WORKBENCH_RAIL_VISIBILITY)
  })

  it('侧栏可选项和可见性名单对齐', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../skin/PhantasiWorkbench.tsx'),
      'utf8',
    )
    for (const pane of WORKBENCH_RAIL_OPTION_PANES) {
      assert.match(src, new RegExp(`pane: '${pane}'`))
    }
  })
})
