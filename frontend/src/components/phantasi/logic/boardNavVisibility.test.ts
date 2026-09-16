import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BOARD_NAV_STORAGE_KEY,
  DEFAULT_BOARD_NAV_VISIBILITY,
  JOURNAL_BOARD_NAV_PANES,
  boardNavAllowsLevel,
  boardNavLevelsForPane,
  effectiveBoardNavLevel,
  filterBoardNavItems,
  normalizeBoardNavVisibility,
  readBoardNavVisibility,
  setBoardNavPane,
  tighterVisibility,
  writeBoardNavVisibility,
} from './boardNavVisibility.ts'

const guest = { isAuthenticated: false, isAdmin: false }
const user = { isAuthenticated: true, isAdmin: false }
const admin = { isAuthenticated: true, isAdmin: true }

describe('boardNavVisibility', () => {
  it('手帐全关则子页全关；全开时自定义更严的一侧生效', () => {
    assert.equal(tighterVisibility('admin', 'all'), 'admin')
    assert.equal(tighterVisibility('all', 'authenticated'), 'authenticated')
    assert.equal(tighterVisibility('all', 'all'), 'all')
    assert.equal(tighterVisibility('authenticated', 'all'), 'authenticated')
    assert.equal(tighterVisibility('authenticated', 'admin'), 'admin')
    const custom = setBoardNavPane(
      DEFAULT_BOARD_NAV_VISIBILITY,
      'notes',
      'authenticated',
    )
    assert.equal(effectiveBoardNavLevel(custom, 'notes', 'admin'), 'admin')
    assert.equal(effectiveBoardNavLevel(custom, 'notes', 'all'), 'authenticated')
  })

  it('旧布尔值能读回来：开是全体，关是管理员', () => {
    const migrated = normalizeBoardNavVisibility({
      feeds: true,
      starred: true,
      notes: 'authenticated',
      sites: 'admin',
    })
    assert.equal(migrated.feeds, 'all')
    assert.equal(migrated.starred, 'authenticated')
    assert.equal(migrated.notes, 'authenticated')
    assert.equal(migrated.sites, 'admin')
    assert.equal(migrated.workbench, 'admin')
    assert.equal(
      normalizeBoardNavVisibility({ starred: false }).starred,
      'admin',
    )
  })

  it('工作台只有管理员，全体和登录无效', () => {
    assert.deepEqual(boardNavLevelsForPane('workbench'), ['admin'])
    assert.deepEqual(boardNavLevelsForPane('feeds'), [
      'all',
      'authenticated',
      'admin',
    ])
    assert.equal(
      setBoardNavPane(DEFAULT_BOARD_NAV_VISIBILITY, 'workbench', 'all', 'all')
        .workbench,
      'admin',
    )
    assert.equal(
      effectiveBoardNavLevel(DEFAULT_BOARD_NAV_VISIBILITY, 'workbench', 'all'),
      'admin',
    )
    const options = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../skin/PhantasiWorkbenchHomeOptions.tsx'),
      'utf8',
    )
    assert.match(options, /JOURNAL_BOARD_NAV_OPTIONS/)
    assert.doesNotMatch(options, /boardWorkbench/)
  })

  it('收藏没有全体，最开是登录用户', () => {
    assert.deepEqual(boardNavLevelsForPane('starred'), [
      'authenticated',
      'admin',
    ])
    assert.equal(
      normalizeBoardNavVisibility({ starred: 'all' }).starred,
      'authenticated',
    )
    assert.equal(
      setBoardNavPane(DEFAULT_BOARD_NAV_VISIBILITY, 'starred', 'all', 'all')
        .starred,
      'authenticated',
    )
    assert.equal(
      effectiveBoardNavLevel(DEFAULT_BOARD_NAV_VISIBILITY, 'starred', 'all'),
      'authenticated',
    )
  })

  it('各子页互不卡住；模块未全开不能改', () => {
    const closed = setBoardNavPane(
      setBoardNavPane(DEFAULT_BOARD_NAV_VISIBILITY, 'feeds', 'admin'),
      'notes',
      'admin',
    )
    assert.equal(closed.feeds, 'admin')
    assert.equal(closed.notes, 'admin')
    assert.equal(closed.sites, 'all')
    assert.equal(boardNavAllowsLevel(closed, 'sites', 'admin', 'all'), true)
    const tighter = setBoardNavPane(closed, 'sites', 'admin')
    assert.equal(tighter.sites, 'admin')
    assert.equal(boardNavAllowsLevel(tighter, 'sites', 'all', 'admin'), false)
    assert.equal(setBoardNavPane(tighter, 'sites', 'all', 'admin').sites, 'admin')
  })

  it('按模块+自定义裁二级菜单', () => {
    const vis = setBoardNavPane(
      DEFAULT_BOARD_NAV_VISIBILITY,
      'notes',
      'admin',
    )
    assert.deepEqual(
      filterBoardNavItems(
        [{ id: 'feeds' }, { id: 'notes' }, { id: 'sites' }, { id: 'topic' }],
        vis,
        'all',
        guest,
      ).map((item) => item.id),
      ['feeds', 'sites', 'topic'],
    )
    assert.deepEqual(
      filterBoardNavItems(
        [{ id: 'feeds' }, { id: 'notes' }],
        vis,
        'admin',
        guest,
      ).map((item) => item.id),
      [],
    )
    assert.deepEqual(
      filterBoardNavItems(
        [{ id: 'feeds' }, { id: 'notes' }],
        vis,
        'admin',
        admin,
      ).map((item) => item.id),
      ['feeds', 'notes'],
    )
    assert.deepEqual(
      filterBoardNavItems(
        [{ id: 'feeds' }, { id: 'notes' }],
        vis,
        'authenticated',
        user,
      ).map((item) => item.id),
      ['feeds'],
    )
  })

  it('localStorage 读坏值不抛', () => {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    writeBoardNavVisibility(
      setBoardNavPane(DEFAULT_BOARD_NAV_VISIBILITY, 'starred', 'admin'),
    )
    assert.equal(readBoardNavVisibility().starred, 'admin')
    store.set(BOARD_NAV_STORAGE_KEY, '{')
    assert.deepEqual(readBoardNavVisibility(), DEFAULT_BOARD_NAV_VISIBILITY)
  })

  it('可选项和二级菜单名单对齐', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../boardNav.tsx'),
      'utf8',
    )
    for (const pane of JOURNAL_BOARD_NAV_PANES) {
      assert.match(src, new RegExp(`id: '${pane}'`))
    }
  })
})
