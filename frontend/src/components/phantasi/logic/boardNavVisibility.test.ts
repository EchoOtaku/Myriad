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
  boardNavAudienceFloor,
  boardNavLevelsForPane,
  effectiveBoardNavLevel,
  ensureBoardNavFloor,
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
    assert.equal(migrated.starred, 'admin')
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
    assert.match(options, /boardNavAllowsLevel/)
    assert.match(options, /parent !== 'admin'/)
    assert.doesNotMatch(options, /boardWorkbench/)
    assert.doesNotMatch(options, /phantasi\.starred/)
  })

  it('收藏只有管理员，全体和登录无效', () => {
    assert.deepEqual(boardNavLevelsForPane('starred'), ['admin'])
    assert.equal(
      normalizeBoardNavVisibility({ starred: 'all' }).starred,
      'admin',
    )
    assert.equal(
      setBoardNavPane(DEFAULT_BOARD_NAV_VISIBILITY, 'starred', 'all', 'all')
        .starred,
      'admin',
    )
    assert.equal(
      effectiveBoardNavLevel(DEFAULT_BOARD_NAV_VISIBILITY, 'starred', 'all'),
      'admin',
    )
  })

  it('各子页互不卡住；开口层至少留一页', () => {
    assert.equal(boardNavAudienceFloor('all'), 'all')
    assert.equal(boardNavAudienceFloor('authenticated'), 'authenticated')
    assert.equal(boardNavAudienceFloor('admin'), null)
    const closed = setBoardNavPane(
      setBoardNavPane(DEFAULT_BOARD_NAV_VISIBILITY, 'feeds', 'admin'),
      'notes',
      'admin',
    )
    assert.equal(closed.feeds, 'admin')
    assert.equal(closed.notes, 'admin')
    assert.equal(closed.sites, 'all')
    assert.equal(boardNavAllowsLevel(closed, 'sites', 'admin', 'all'), false)
    assert.equal(setBoardNavPane(closed, 'sites', 'admin', 'all').sites, 'all')
    assert.equal(boardNavAllowsLevel(closed, 'notes', 'all', 'all'), true)
    assert.equal(setBoardNavPane(closed, 'notes', 'all', 'all').notes, 'all')
    const locked = normalizeBoardNavVisibility({
      feeds: 'admin',
      notes: 'admin',
      sites: 'admin',
    })
    assert.equal(boardNavAllowsLevel(locked, 'sites', 'all', 'admin'), false)
    assert.equal(setBoardNavPane(locked, 'sites', 'all', 'admin').sites, 'admin')
    const emptied = normalizeBoardNavVisibility({
      feeds: 'admin',
      notes: 'admin',
      sites: 'admin',
    })
    assert.equal(ensureBoardNavFloor(emptied, 'all').feeds, 'all')
    assert.equal(
      ensureBoardNavFloor(emptied, 'authenticated').feeds,
      'authenticated',
    )
    assert.equal(effectiveBoardNavLevel(emptied, 'feeds', 'all'), 'all')
    const login = setBoardNavPane(
      setBoardNavPane(
        DEFAULT_BOARD_NAV_VISIBILITY,
        'feeds',
        'admin',
        'authenticated',
      ),
      'notes',
      'admin',
      'authenticated',
    )
    assert.equal(login.feeds, 'admin')
    assert.equal(login.notes, 'admin')
    assert.equal(login.sites, 'all')
    assert.equal(
      boardNavAllowsLevel(login, 'sites', 'admin', 'authenticated'),
      false,
    )
    assert.equal(
      setBoardNavPane(login, 'sites', 'admin', 'authenticated').sites,
      'all',
    )
    assert.deepEqual(boardNavLevelsForPane('feeds', 'authenticated'), [
      'authenticated',
      'admin',
    ])
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
