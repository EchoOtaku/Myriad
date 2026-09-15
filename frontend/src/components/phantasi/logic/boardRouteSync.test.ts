import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideNavWrite, decidePathSync } from './boardRouteSync.ts'
import { pathForActiveIdChange, pathShowsNavId } from './journalRoutes.ts'

describe('decidePathSync', () => {
  it('刷新板块深链只同步高亮，不回写', () => {
    assert.deepEqual(decidePathSync('/journal/notes', false, false), {
      action: 'apply',
      navId: 'notes',
    })
    assert.deepEqual(decidePathSync('/journal/friends', false, false), {
      action: 'apply',
      navId: 'sites',
    })
    assert.deepEqual(decidePathSync('/journal/feeds/48', false, false), {
      action: 'apply',
      navId: 'feeds',
    })
    assert.deepEqual(decidePathSync('/journal/topics/ai', false, false), {
      action: 'apply',
      navId: 'feeds',
    })
    assert.deepEqual(decidePathSync('/journal/articles/946', false, false), {
      action: 'keep-article',
    })
  })

  it('收藏/工作台看身份；认不出的手帐地址只回根一次', () => {
    assert.deepEqual(decidePathSync('/journal/starred', false, false), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decidePathSync('/journal/starred', true, false), {
      action: 'apply',
      navId: 'starred',
    })
    assert.deepEqual(decidePathSync('/journal/workbench/notes', false, false), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decidePathSync('/journal/workbench/notes', true, true), {
      action: 'apply',
      navId: 'workbench',
    })
    assert.deepEqual(decidePathSync('/journal/nope', false, false), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decidePathSync('/journal/feeds/not-a-number', false, false), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decidePathSync('/journal/notes.xml', false, false), {
      action: 'none',
    })
    assert.deepEqual(decidePathSync('/library', false, false), {
      action: 'none',
    })
  })
})

describe('decideNavWrite', () => {
  it('刷新 /journal/notes：首屏还是 feeds 时不得 navigate', () => {
    const waiting = decideNavWrite({
      activeId: 'feeds',
      prevActiveId: 'notes',
      pathname: '/journal/notes',
      pending: { target: 'notes', from: 'feeds' },
    })
    assert.equal(waiting.navigateTo, null)
    assert.deepEqual(waiting.pending, { target: 'notes', from: 'feeds' })

    const landed = decideNavWrite({
      activeId: 'notes',
      prevActiveId: 'notes',
      pathname: '/journal/notes',
      pending: { target: 'notes', from: 'feeds' },
    })
    assert.equal(landed.navigateTo, null)
    assert.equal(landed.pending, null)
    assert.equal(landed.applyBoard, false)
  })

  it('刷新源/主题/文章：高亮已是 feeds，不改地址', () => {
    for (const pathname of [
      '/journal/feeds/48',
      '/journal/topics/ai',
      '/journal/articles/946',
    ]) {
      const decision = decideNavWrite({
        activeId: 'feeds',
        prevActiveId: 'feeds',
        pathname,
        pending: null,
      })
      assert.equal(decision.navigateTo, null, pathname)
    }
  })

  it('点导航才改地址；文章页点订阅要离开文章', () => {
    assert.equal(
      decideNavWrite({
        activeId: 'notes',
        prevActiveId: 'feeds',
        pathname: '/journal',
        pending: null,
      }).navigateTo,
      '/journal/notes',
    )
    assert.equal(
      decideNavWrite({
        activeId: 'feeds',
        prevActiveId: 'notes',
        pathname: '/journal/notes',
        pending: null,
      }).navigateTo,
      '/journal',
    )
    assert.equal(
      decideNavWrite({
        activeId: 'feeds',
        prevActiveId: 'notes',
        pathname: '/journal/articles/946',
        pending: null,
      }).navigateTo,
      '/journal',
    )
    assert.equal(
      decideNavWrite({
        activeId: 'notes',
        prevActiveId: 'feeds',
        pathname: '/journal/articles/946',
        pending: null,
      }).navigateTo,
      '/journal/notes',
    )
  })

  it('路径同步落地前点了别的项，按用户点击走', () => {
    const decision = decideNavWrite({
      activeId: 'sites',
      prevActiveId: 'notes',
      pathname: '/journal/notes',
      pending: { target: 'notes', from: 'feeds' },
    })
    assert.equal(decision.navigateTo, '/journal/friends')
    assert.equal(decision.pending, null)
    assert.equal(decision.applyBoard, true)
  })
})

describe('pathShowsNavId after article overlay', () => {
  it('文章不算已经停在任何板块首页', () => {
    assert.equal(pathShowsNavId('/journal/articles/1', 'feeds'), false)
    assert.equal(pathShowsNavId('/journal/articles/1', 'notes'), false)
    assert.equal(pathShowsNavId('/journal/feeds/9', 'feeds'), true)
    assert.equal(
      pathForActiveIdChange('/journal/articles/1', 'feeds', false),
      '/journal',
    )
    assert.equal(pathForActiveIdChange('/journal/notes', 'feeds', true), null)
  })
})
