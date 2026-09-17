import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isJournalSyndicationPath,
  JOURNAL_ROOT,
  journalBoardPath,
  journalItemPath,
  journalListPath,
  journalPathForNavId,
  journalSourceFocus,
  navIdForJournalLocation,
  parseJournalPath,
  pathForActiveIdChange,
  pathShowsNavId,
  seoJournalFollow,
  seoListNoindex,
  WORKBENCH_PANE_PATHS,
} from './journalRoutes.ts'

describe('parseJournalPath', () => {
  it('认板块、别名和文章', () => {
    assert.deepEqual(parseJournalPath('/journal'), { kind: 'feeds' })
    assert.deepEqual(parseJournalPath('/journal/'), { kind: 'feeds' })
    assert.deepEqual(parseJournalPath('/journal/feeds'), { kind: 'feeds' })
    assert.deepEqual(parseJournalPath('/journal/notes'), { kind: 'notes' })
    assert.deepEqual(parseJournalPath('/journal/friends'), { kind: 'friends' })
    assert.deepEqual(parseJournalPath('/journal/starred'), { kind: 'starred' })
    assert.deepEqual(parseJournalPath('/journal/articles/12'), {
      kind: 'article',
      itemId: '12',
    })
    assert.deepEqual(parseJournalPath('/journal/topics/AI%20news'), {
      kind: 'topic',
      topic: 'AI news',
    })
    assert.equal(parseJournalPath('/journal/feeds/9'), null)
    assert.equal(parseJournalPath('/journal/feeds/not-a-number'), null)
    assert.equal(parseJournalPath('/phantasi'), null)
  })

  it('工作台先匹配更长段', () => {
    assert.deepEqual(parseJournalPath('/journal/workbench'), {
      kind: 'workbench',
      pane: 'home',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/notes'), {
      kind: 'workbench',
      pane: 'notes',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/reviews'), {
      kind: 'workbench',
      pane: 'reviews',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/notes/import'), {
      kind: 'workbench',
      pane: 'notesIo',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/notes/categories'), {
      kind: 'workbench',
      pane: 'noteCategories',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/feeds'), {
      kind: 'workbench',
      pane: 'sources',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/feeds/add'), {
      kind: 'workbench',
      pane: 'add',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/feeds/topics'), {
      kind: 'workbench',
      pane: 'topics',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/feeds/import'), {
      kind: 'workbench',
      pane: 'feedsIo',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/feeds/categories'), {
      kind: 'workbench',
      pane: 'sourceCategories',
    })
    assert.deepEqual(parseJournalPath('/journal/workbench/unknown'), {
      kind: 'workbench',
      pane: 'home',
    })
    assert.equal(
      WORKBENCH_PANE_PATHS.rsshub,
      '/journal/workbench/rsshub',
    )
  })
})

describe('journalListPath', () => {
  it('板块、筛选、工作台各有子路径', () => {
    assert.equal(
      journalListPath({ viewMode: 'sources', board: 'feeds' }),
      JOURNAL_ROOT,
    )
    assert.equal(journalBoardPath('notes'), '/journal/notes')
    assert.equal(journalBoardPath('sites'), '/journal/friends')
    assert.equal(
      journalListPath({
        viewMode: 'topic-feed',
        board: 'feeds',
        topic: 'rust',
      }),
      '/journal/topics/rust',
    )
    assert.equal(
      journalListPath({
        viewMode: 'sources',
        board: 'feeds',
      }),
      '/journal',
    )
    assert.equal(
      journalListPath({ viewMode: 'starred', board: 'feeds' }),
      '/journal/starred',
    )
    assert.equal(
      journalListPath({
        viewMode: 'workbench',
        board: 'feeds',
        workbenchPane: 'comments',
      }),
      '/journal/workbench/comments',
    )
    assert.equal(
      journalListPath({
        viewMode: 'workbench',
        board: 'feeds',
        workbenchPane: 'reviews',
      }),
      '/journal/workbench/reviews',
    )
    assert.equal(journalItemPath(8), '/journal/articles/8')
    assert.equal(journalPathForNavId('sites'), '/journal/friends')
  })
})

describe('nav helpers', () => {
  it('主题算停在订阅下；网站卡片没有独立地址；文章是叠层', () => {
    assert.equal(pathShowsNavId('/journal', 'feeds'), true)
    assert.equal(pathShowsNavId('/journal/feeds', 'feeds'), true)
    assert.equal(pathShowsNavId('/journal/notes', 'notes'), true)
    assert.equal(pathShowsNavId('/journal/topics/x', 'feeds'), true)
    assert.equal(pathShowsNavId('/journal/feeds/1', 'feeds'), false)
    assert.equal(pathShowsNavId('/journal/articles/1', 'feeds'), false)
    assert.equal(pathShowsNavId('/journal/articles/1', 'notes'), false)
    assert.equal(pathShowsNavId('/journal/notes', 'feeds'), false)
    assert.equal(
      navIdForJournalLocation({ kind: 'friends' }, true, false),
      'sites',
    )
    assert.equal(
      navIdForJournalLocation({ kind: 'starred' }, false, false),
      'feeds',
    )
    assert.equal(
      navIdForJournalLocation({ kind: 'starred' }, true, false),
      'feeds',
    )
    assert.equal(
      navIdForJournalLocation({ kind: 'starred' }, true, true),
      'starred',
    )
    assert.equal(seoListNoindex('workbench'), true)
    assert.equal(seoListNoindex('starred'), true)
    assert.equal(seoListNoindex('topic-feed'), true)
    assert.equal(seoListNoindex('sources'), false)
    assert.equal(isJournalSyndicationPath('/journal/feeds/4'), false)
    assert.equal(isJournalSyndicationPath('/journal/topics/ai'), true)
    assert.equal(isJournalSyndicationPath('/journal'), false)
    assert.equal(isJournalSyndicationPath('/journal/notes'), false)
    assert.equal(seoJournalFollow('/journal/feeds/4', 'sources'), false)
    assert.equal(seoJournalFollow('/journal', 'workbench'), false)
  })

  it('路径同步过来的 activeId 不得回写；点导航才改地址', () => {
    assert.equal(pathForActiveIdChange('/journal/notes', 'feeds', true), null)
    assert.equal(pathForActiveIdChange('/journal/friends', 'feeds', true), null)
    assert.equal(pathForActiveIdChange('/journal/feeds/9', 'feeds', false), '/journal')
    assert.equal(pathForActiveIdChange('/journal/topics/ai', 'feeds', false), null)
    assert.equal(
      pathForActiveIdChange('/journal/articles/1', 'feeds', false),
      '/journal',
    )
    assert.equal(
      pathForActiveIdChange('/journal', 'notes', false),
      '/journal/notes',
    )
    assert.equal(
      pathForActiveIdChange('/journal/articles/1', 'notes', false),
      '/journal/notes',
    )
  })
})

it('cross-page source focus is validated navigation state, not a route', () => {
  assert.equal(journalSourceFocus({ journalSourceId: 9 }), 9)
  for (const state of [null, {}, { journalSourceId: '9' }, { journalSourceId: -1 }, { journalSourceId: 1.5 }]) {
    assert.equal(journalSourceFocus(state), null)
  }
})
