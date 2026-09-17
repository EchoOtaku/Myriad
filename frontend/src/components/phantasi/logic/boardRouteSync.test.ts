import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideNavWrite, decidePathSync } from './boardRouteSync.ts'
import { pathForActiveIdChange, pathShowsNavId } from './journalRoutes.ts'

const VISITOR_NAV = ['feeds', 'notes', 'sites']
const ADMIN_NAV = [...VISITOR_NAV, 'starred', 'workbench']

function decideVisitorPath(pathname: string, isAuthenticated = false) {
  return decidePathSync(pathname, isAuthenticated, false, VISITOR_NAV)
}

function decideAdminPath(pathname: string) {
  return decidePathSync(pathname, true, true, ADMIN_NAV)
}

describe('decidePathSync', () => {
  it('刷新板块深链只同步高亮，不回写', () => {
    assert.deepEqual(decideVisitorPath('/journal/notes'), {
      action: 'apply',
      navId: 'notes',
    })
    assert.deepEqual(decideVisitorPath('/journal/friends'), {
      action: 'apply',
      navId: 'sites',
    })
    assert.deepEqual(decideVisitorPath('/journal/feeds/48'), {
      action: 'apply',
      navId: 'feeds',
    })
    assert.deepEqual(decideVisitorPath('/journal/topics/ai'), {
      action: 'apply',
      navId: 'feeds',
    })
    assert.deepEqual(decideVisitorPath('/journal/articles/946'), {
      action: 'keep-article',
    })
  })

  it('收藏/工作台看身份；认不出的手帐地址只回根一次', () => {
    assert.deepEqual(decideVisitorPath('/journal/starred'), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decideVisitorPath('/journal/starred', true), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decideAdminPath('/journal/starred'), {
      action: 'apply',
      navId: 'starred',
    })
    assert.deepEqual(decideVisitorPath('/journal/workbench/notes'), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decideAdminPath('/journal/workbench/notes'), {
      action: 'apply',
      navId: 'workbench',
    })
    assert.deepEqual(decideVisitorPath('/journal/nope'), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decideVisitorPath('/journal/feeds/not-a-number'), {
      action: 'bounce',
      to: '/journal',
    })
    assert.deepEqual(decideVisitorPath('/journal/notes.xml'), {
      action: 'none',
    })
    assert.deepEqual(decideVisitorPath('/library'), {
      action: 'none',
    })
  })

  it('已关闭板块及其子页面回退到第一个可见板块', () => {
    for (const pathname of [
      '/journal',
      '/journal/feeds/48',
      '/journal/topics/ai',
    ]) {
      assert.deepEqual(
        decidePathSync(pathname, false, false, ['notes', 'sites']),
        {
          action: 'bounce',
          to: '/journal/notes',
        },
      )
    }
    assert.deepEqual(
      decidePathSync('/journal/notes', false, false, ['sites']),
      {
        action: 'bounce',
        to: '/journal/friends',
      },
    )
    assert.deepEqual(
      decidePathSync('/journal/friends', false, false, ['notes']),
      {
        action: 'bounce',
        to: '/journal/notes',
      },
    )
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
