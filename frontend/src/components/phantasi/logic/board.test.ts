import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  boardEntry,
  collectSourceCategories,
  collectWorkbenchSourceCategories,
  collectWorkbenchSourceKinds,
  sourceMatchesCategory,
  sourceMatchesKind,
  workbenchSourceKind,
  filterItemsByQuery,
  filterLaneItems,
  haystackMatchesQuery,
  filterSourcesByQuery,
  isPhantasiBoard,
  isFriendSource,
  isNotesSource,
  isSiteSource,
  navIdForBoardEntry,
  refreshableSourceCount,
  resolveBoardParam,
  showsFilterLane,
  sortSourcesForBoard,
  sourcesForBoard,
  viewForBoardEntry,
  visitFriendHref,
} from './board.ts'
import { makeSource } from './fixtures.ts'

describe('isSiteSource', () => {
  it('只认 source_type === link', () => {
    assert.equal(isSiteSource(makeSource({ source_type: 'link' })), true)
    assert.equal(isSiteSource(makeSource({ source_type: 'rss' })), false)
    assert.equal(
      refreshableSourceCount([
        makeSource({ source_type: 'link' }),
        makeSource({ source_type: 'rss' }),
      ]),
      1,
    )
  })
})

describe('visitFriendHref', () => {
  it('优先站点地址，没有再用源地址', () => {
    assert.equal(
      visitFriendHref(
        makeSource({ site_url: 'https://friend.example', url: 'https://feed.example' }),
      ),
      'https://friend.example',
    )
    assert.equal(
      visitFriendHref(makeSource({ site_url: '', url: 'https://feed.example' })),
      'https://feed.example',
    )
  })

  it('都空则不去', () => {
    assert.equal(visitFriendHref(makeSource({ site_url: '', url: '' })), null)
    assert.equal(visitFriendHref(makeSource({ site_url: '  ', url: '  ' })), null)
  })
})

describe('isFriendSource', () => {
  it('友情链接分类都收，入口型没挂分类也收', () => {
    assert.equal(isFriendSource(makeSource({ source_type: 'link' })), true)
    const friendRss = makeSource({ source_type: 'rss', category: '友情链接' })
    assert.equal(isFriendSource(friendRss), true)
    assert.equal(isSiteSource(friendRss), false)
    assert.equal(
      isFriendSource(makeSource({ source_type: 'rss', category: 'friend_links' })),
      true,
    )
    assert.equal(
      isFriendSource(makeSource({ source_type: 'rss', category: 'Friend Links' })),
      true,
    )
    assert.equal(
      isFriendSource(makeSource({ source_type: 'phantasiai', category: '友情链接' })),
      true,
    )
    assert.equal(isFriendSource(makeSource({ source_type: 'rss' })), false)
    assert.equal(
      isFriendSource(makeSource({ source_type: 'rss', category: '测试' })),
      false,
    )
  })

  it('叠着「我」的友情链接也进朋友们', () => {
    const s = makeSource({
      source_type: 'rss',
      category: '我,友情链接',
    })
    assert.equal(isNotesSource(s), true)
    assert.equal(isFriendSource(s), true)
  })
})

describe('isNotesSource', () => {
  it('笔记源和「我」分类都算', () => {
    assert.equal(
      isNotesSource(makeSource({ source_type: 'note', category: '我' })),
      true,
    )
    assert.equal(
      isNotesSource(makeSource({ source_type: 'rss', category: '我' })),
      true,
    )
    assert.equal(
      isNotesSource(makeSource({ source_type: 'rss', category: '科技' })),
      false,
    )
    assert.equal(
      isNotesSource(makeSource({ source_type: 'rss', category: 'mine' })),
      true,
    )
  })
})

describe('sourcesForBoard', () => {
  const link = makeSource({ id: 1, source_type: 'link' })
  const rss = makeSource({ id: 2, source_type: 'rss' })
  const mine = makeSource({ id: 3, source_type: 'rss', category: '我' })
  const friendRss = makeSource({
    id: 5,
    source_type: 'rss',
    category: '友情链接',
  })
  const note = makeSource({ id: 4, source_type: 'note', category: '我' })
  const all = [link, rss, mine, friendRss, note]

  it('sites 收友情链接分类，以及没挂分类的入口型', () => {
    assert.deepEqual(
      sourcesForBoard(all, 'sites').map((s) => s.id),
      [1, 5],
    )
  })

  it('feeds 收会抓的源，含友情链接 RSS，不收入口和笔记源', () => {
    assert.deepEqual(
      sourcesForBoard(all, 'feeds').map((s) => s.id),
      [2, 3, 5],
    )
  })

  it('notes 收笔记源和「我」分类', () => {
    assert.deepEqual(
      sourcesForBoard(all, 'notes').map((s) => s.id),
      [3, 4],
    )
  })
})

describe('boardEntry', () => {
  it('三个板块都进源墙', () => {
    assert.deepEqual(boardEntry('notes'), { view: 'sources', board: 'notes' })
    assert.deepEqual(boardEntry('feeds'), { view: 'sources', board: 'feeds' })
    assert.deepEqual(boardEntry('sites'), { view: 'sources', board: 'sites' })
  })
})

describe('resolveBoardParam', () => {
  it('新参数直通', () => {
    for (const board of ['feeds', 'notes', 'sites'] as const) {
      assert.deepEqual(resolveBoardParam(board), boardEntry(board))
    }
  })

  it('旧 ?category= 的四个取值都还能落地', () => {
    assert.deepEqual(resolveBoardParam('all'), {
      view: 'sources',
      board: 'feeds',
    })
    assert.deepEqual(resolveBoardParam('friends'), {
      view: 'sources',
      board: 'sites',
    })
    assert.deepEqual(resolveBoardParam('mine'), {
      view: 'sources',
      board: 'notes',
    })
  })

  it('收藏不再是板块：落在订阅板块的收藏视图', () => {
    assert.deepEqual(resolveBoardParam('starred'), {
      view: 'starred',
      board: 'feeds',
    })
  })

  it('登录后二级导航高亮收藏，游客落到订阅', () => {
    const entry = resolveBoardParam('starred')!
    assert.equal(navIdForBoardEntry(entry, true), 'starred')
    assert.equal(navIdForBoardEntry(entry, false), 'feeds')
    assert.equal(
      navIdForBoardEntry({ view: 'sources', board: 'notes' }, true),
      'notes',
    )
  })

  it('认不出的取值返回 null，不回落默认板块', () => {
    assert.equal(resolveBoardParam('nope'), null)
  })

  it('工作台不是板块：管理员高亮 workbench，其他人落到订阅', () => {
    assert.deepEqual(resolveBoardParam('workbench'), { view: 'workbench' })
    const entry = resolveBoardParam('workbench')!
    assert.equal(navIdForBoardEntry(entry, true, true), 'workbench')
    assert.equal(navIdForBoardEntry(entry, true, false), 'feeds')
    assert.equal(navIdForBoardEntry(entry, false, false), 'feeds')
    assert.equal(viewForBoardEntry(entry, true, true), 'workbench')
    assert.equal(viewForBoardEntry(entry, true, false), 'sources')
    assert.equal(isPhantasiBoard('workbench'), false)
  })
})

describe('viewForBoardEntry / filterLaneItems', () => {
  it('游客收藏深链降到源墙', () => {
    assert.equal(
      viewForBoardEntry({ view: 'starred', board: 'feeds' }, false),
      'sources',
    )
    assert.equal(
      viewForBoardEntry({ view: 'starred', board: 'feeds' }, true),
      'starred',
    )
    assert.deepEqual(filterLaneItems('sources', [1], []), [])
    assert.deepEqual(filterLaneItems('starred', [1], []), [1])
    assert.equal(showsFilterLane('starred', false, true), true)
    assert.equal(showsFilterLane('starred', false, false), false)
    assert.equal(showsFilterLane('topic-feed', true, false), true)
  })
})

describe('isPhantasiBoard', () => {
  it('只认三个板块 id', () => {
    assert.equal(isPhantasiBoard('feeds'), true)
    assert.equal(isPhantasiBoard('friends'), false)
    assert.equal(isPhantasiBoard('starred'), false)
    assert.equal(isPhantasiBoard('workbench'), false)
  })
})

describe('collectSourceCategories', () => {
  it('拆逗号、去空、去重', () => {
    assert.deepEqual(
      collectSourceCategories([
        makeSource({ category: '技术, 我' }),
        makeSource({ category: '技术' }),
        makeSource({ category: null }),
      ]).toSorted(),
      ['我', '技术'],
    )
  })
})

describe('collectWorkbenchSourceCategories', () => {
  it('只收源上已有的分类，预置名收成官网名，不造未分类', () => {
    assert.deepEqual(
      collectWorkbenchSourceCategories([
        makeSource({ category: 'friend_links, 技术' }),
        makeSource({ category: 'mine' }),
        makeSource({ category: null }),
      ]).toSorted(),
      ['友情链接', '我', '技术'].toSorted(),
    )
  })
})

describe('workbenchSourceKind', () => {
  it('按订阅源类型分，不按板块', () => {
    assert.equal(workbenchSourceKind(makeSource({ source_type: 'rss' })), 'rss')
    assert.equal(
      workbenchSourceKind(makeSource({ source_type: 'phantasiai', feed_type: 'atom' })),
      'rss',
    )
    assert.equal(
      workbenchSourceKind(makeSource({ source_type: 'rsshub', feed_type: 'rss' })),
      'rsshub',
    )
    assert.equal(
      workbenchSourceKind(makeSource({ source_type: 'rss', feed_type: 'rsshub' })),
      'rsshub',
    )
    assert.equal(
      workbenchSourceKind(makeSource({ source_type: 'rss', feed_type: 'notion' })),
      'notion',
    )
    assert.equal(workbenchSourceKind(makeSource({ source_type: 'link' })), 'link')
    assert.equal(workbenchSourceKind(makeSource({ source_type: 'note' })), 'note')
  })
})

describe('collectWorkbenchSourceKinds', () => {
  it('只收源上已有的类型，顺序固定', () => {
    assert.deepEqual(
      collectWorkbenchSourceKinds([
        makeSource({ source_type: 'note' }),
        makeSource({ source_type: 'rss', feed_type: 'rsshub' }),
        makeSource({ source_type: 'link' }),
        makeSource({ source_type: 'rss' }),
      ]),
      ['rss', 'rsshub', 'link', 'note'],
    )
  })
})

describe('sourceMatchesKind', () => {
  it('只认同一种订阅源类型', () => {
    assert.equal(sourceMatchesKind(makeSource({ source_type: 'link' }), 'link'), true)
    assert.equal(sourceMatchesKind(makeSource({ source_type: 'rss' }), 'link'), false)
    assert.equal(
      sourceMatchesKind(makeSource({ feed_type: 'rsshub' }), 'rsshub'),
      true,
    )
  })
})

describe('sourceMatchesCategory', () => {
  it('预置分类认别名，普通分类精确匹配', () => {
    assert.equal(
      sourceMatchesCategory(makeSource({ category: 'friend_links' }), '友情链接'),
      true,
    )
    assert.equal(
      sourceMatchesCategory(makeSource({ category: '我,技术' }), '技术'),
      true,
    )
    assert.equal(
      sourceMatchesCategory(makeSource({ category: '技术' }), '我'),
      false,
    )
    assert.equal(sourceMatchesCategory(makeSource({ category: null }), '技术'), false)
  })
})

describe('filterSourcesByQuery', () => {
  it('空词原样拷贝', () => {
    const sources = [makeSource({ name: 'A' })]
    const next = filterSourcesByQuery(sources, '  ')
    assert.deepEqual(next.map((s) => s.id), sources.map((s) => s.id))
    assert.notEqual(next, sources)
  })

  it('按名 / 址 / 简介收', () => {
    const sources = [
      makeSource({ name: '星辰博客', url: 'https://a.com', description: null }),
      makeSource({ name: '其他', url: 'https://b.com/feed', description: 'hello' }),
    ]
    assert.equal(filterSourcesByQuery(sources, '星辰')[0]?.name, '星辰博客')
    assert.equal(filterSourcesByQuery(sources, 'B.COM')[0]?.name, '其他')
    assert.equal(filterSourcesByQuery(sources, 'hello')[0]?.name, '其他')
  })
})

describe('filterItemsByQuery', () => {
  it('空词原样拷贝；按标题 / 源名 / 作者收', () => {
    assert.equal(haystackMatchesQuery('  ', '星辰'), true)
    const items = [
      { title: '星辰夜话', source_name: '博客', author: null },
      { title: '别的', source_name: '日报', author: 'Ada' },
    ]
    const next = filterItemsByQuery(items, '  ')
    assert.deepEqual(next, items)
    assert.notEqual(next, items)
    assert.equal(filterItemsByQuery(items, '夜话')[0]?.title, '星辰夜话')
    assert.equal(filterItemsByQuery(items, '日报')[0]?.title, '别的')
    assert.equal(filterItemsByQuery(items, 'ada')[0]?.title, '别的')
  })
})

describe('sortSourcesForBoard', () => {
  it('拼音按名字', () => {
    const sorted = sortSourcesForBoard(
      [
        makeSource({ id: 2, name: '星辰' }),
        makeSource({ id: 1, name: '白的' }),
      ],
      'pinyin',
      'guest',
      0,
      'zh-CN',
    )
    assert.deepEqual(
      sorted.map((s) => s.name),
      ['白的', '星辰'],
    )
  })

  it('分类按主分类再按名', () => {
    const sorted = sortSourcesForBoard(
      [
        makeSource({ id: 2, name: 'one-b', category: 'aaa' }),
        makeSource({ id: 1, name: 'two', category: 'zzz' }),
        makeSource({ id: 3, name: 'one-a', category: 'aaa' }),
      ],
      'category',
      'guest',
      0,
    )
    assert.deepEqual(
      sorted.map((s) => s.name),
      ['one-a', 'one-b', 'two'],
    )
  })
})
