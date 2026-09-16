import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  workbenchFeedSourceCount,
  workbenchHomeDrafts,
  workbenchHomeFailedSources,
  workbenchHomeIsEmpty,
  workbenchHomeMediaFace,
  workbenchHomeQuietFails,
  workbenchHomeRecent,
  workbenchHomeScheduleKind,
  workbenchHomeUpcoming,
} from './workbenchHome.ts'

describe('workbenchHomeDrafts', () => {
  it('只收没失败的草稿，按更新倒序，最多三篇', () => {
    const docs = [
      { id: 1, status: 'draft', updated_at: 10, last_error: null },
      { id: 2, status: 'published', updated_at: 40, last_error: null },
      { id: 3, status: 'draft', updated_at: 30, last_error: 'boom' },
      { id: 4, status: 'draft', updated_at: 20, last_error: null },
      { id: 5, status: 'draft', updated_at: 5, last_error: null },
      { id: 6, status: 'draft', updated_at: 1, last_error: null },
    ]
    assert.deepEqual(
      workbenchHomeDrafts(docs).map((doc) => doc.id),
      [4, 1, 5],
    )
  })
})

describe('workbenchHomeUpcoming', () => {
  it('定时按时间正序，没填时间的排前面；失败的不进日历；最多两篇', () => {
    const docs = [
      { id: 1, status: 'scheduled', scheduled_at: 300, last_error: null },
      { id: 2, status: 'scheduled', scheduled_at: null, last_error: null },
      { id: 3, status: 'scheduled', scheduled_at: 100, last_error: 'boom' },
      { id: 4, status: 'draft', scheduled_at: 50, last_error: null },
      { id: 5, status: 'scheduled', scheduled_at: 200, last_error: null },
    ]
    assert.deepEqual(
      workbenchHomeUpcoming(docs).map((doc) => doc.id),
      [2, 5],
    )
  })
})

describe('workbenchHomeScheduleKind', () => {
  it('缺时间、过点、未到点', () => {
    assert.equal(workbenchHomeScheduleKind(null, 100), 'missing')
    assert.equal(workbenchHomeScheduleKind(80, 100), 'overdue')
    assert.equal(workbenchHomeScheduleKind(120, 100), 'soon')
  })
})

describe('workbenchHomeMediaFace', () => {
  it('只有图片和视频才带脸', () => {
    assert.deepEqual(
      workbenchHomeMediaFace({ url: '/media/a.jpg', mime: 'image/jpeg' }),
      { src: '/media/a.jpg', video: false },
    )
    assert.deepEqual(
      workbenchHomeMediaFace({ url: '/media/a.mp4', mime: 'video/mp4' }),
      { src: '/media/a.mp4', video: true },
    )
    assert.equal(
      workbenchHomeMediaFace({ url: '/media/a.pdf', mime: 'application/pdf' }),
      null,
    )
  })
})

describe('workbenchHomeRecent', () => {
  it('笔记、订阅、媒体各一件，上面列过的不重复', () => {
    const recent = workbenchHomeRecent({
      notes: [
        { id: 1, updated_at: 50 },
        { id: 2, updated_at: 10 },
        { id: 7, updated_at: 15 },
      ],
      skipNoteIds: new Set([1]),
      sources: [
        { id: 8, created_at: 40, source_type: 'rss' },
        { id: 11, created_at: 12, source_type: 'rss' },
        { id: 9, created_at: 90, source_type: 'note' },
      ],
      skipSourceIds: new Set([8]),
      media: [
        { id: 3, created_at: 30 },
        { id: 4, created_at: 5 },
      ],
    })
    assert.deepEqual(
      recent.map((item) => `${item.kind}:${item.id}`),
      ['media:3', 'note:7', 'source:11'],
    )
  })
})

describe('workbenchHomeFailedSources', () => {
  it('入口和笔记源不算，要连续失败', () => {
    assert.deepEqual(
      workbenchHomeFailedSources([
        { id: 1, source_type: 'rss', error_count: 2, last_error: 'x' },
        { id: 2, source_type: 'rss', error_count: 1, last_error: 'x' },
        { id: 3, source_type: 'link', error_count: 9, last_error: 'x' },
        { id: 4, source_type: 'note', error_count: 9, last_error: 'x' },
        { id: 5, source_type: 'rsshub', error_count: 3, last_error: null },
      ]).map((source) => source.id),
      [1],
    )
  })
})

describe('workbenchHomeQuietFails', () => {
  it('失败笔记优先，总数封顶', () => {
    const quiet = workbenchHomeQuietFails(
      [
        { id: 1, last_error: 'a' },
        { id: 2, last_error: 'b' },
        { id: 3, last_error: 'c' },
      ],
      [{ id: 9, source_type: 'rss', error_count: 4, last_error: 'z' }],
    )
    assert.deepEqual(
      quiet.notes.map((doc) => doc.id),
      [1, 2, 3],
    )
    assert.deepEqual(quiet.sources, [])
  })
})

describe('workbenchHomeIsEmpty', () => {
  it('笔记和订阅都空才算空站', () => {
    assert.equal(workbenchHomeIsEmpty(0, 0), true)
    assert.equal(workbenchHomeIsEmpty(0, 0, 1), false)
    assert.equal(workbenchHomeIsEmpty(0, 0, 0, 1), false)
    assert.equal(workbenchHomeIsEmpty(1, 0), false)
    assert.equal(
      workbenchFeedSourceCount([
        { source_type: 'note' },
        { source_type: 'rss' },
      ]),
      1,
    )
  })
})
