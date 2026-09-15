import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  JOURNAL_ROOT,
  WORKBENCH_PANE_PATHS,
  journalBoardPath,
  journalItemPath,
  journalListPath,
  journalPathForNavId,
  navIdForJournalLocation,
  parseJournalPath,
  pathShowsNavId,
  isJournalSyndicationPath,
  seoJournalFollow,
  seoListNoindex,
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
    assert.deepEqual(parseJournalPath('/journal/feeds/9'), {
      kind: 'source',
      sourceId: 9,
    })
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
        sourceId: 3,
      }),
      '/journal/feeds/3',
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
    assert.equal(journalItemPath(8), '/journal/articles/8')
    assert.equal(journalPathForNavId('sites'), '/journal/friends')
  })
})

describe('nav helpers', () => {
  it('文章/主题/源不算已经停在板块首页', () => {
    assert.equal(pathShowsNavId('/journal', 'feeds'), true)
    assert.equal(pathShowsNavId('/journal/feeds', 'feeds'), true)
    assert.equal(pathShowsNavId('/journal/notes', 'notes'), true)
    assert.equal(pathShowsNavId('/journal/topics/x', 'feeds'), false)
    assert.equal(pathShowsNavId('/journal/feeds/1', 'feeds'), false)
    assert.equal(pathShowsNavId('/journal/articles/1', 'feeds'), false)
    assert.equal(
      navIdForJournalLocation({ kind: 'friends' }, true, false),
      'sites',
    )
    assert.equal(
      navIdForJournalLocation({ kind: 'starred' }, false, false),
      'feeds',
    )
    assert.equal(seoListNoindex('workbench'), true)
    assert.equal(seoListNoindex('starred'), true)
    assert.equal(seoListNoindex('topic-feed'), true)
    assert.equal(seoListNoindex('sources'), false)
    assert.equal(isJournalSyndicationPath('/journal/feeds/4'), true)
    assert.equal(isJournalSyndicationPath('/journal/topics/ai'), true)
    assert.equal(isJournalSyndicationPath('/journal'), false)
    assert.equal(isJournalSyndicationPath('/journal/notes'), false)
    assert.equal(seoJournalFollow('/journal/feeds/4', 'sources'), true)
    assert.equal(seoJournalFollow('/journal', 'workbench'), false)
  })
})
