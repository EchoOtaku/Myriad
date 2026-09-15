import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { requestCache } from '../../utils/requestCache.ts'
import {
  FEED_STORIES_CACHE_PREFIX,
  feedStoriesCacheKey,
  BOARD_NOTES_CACHE_PREFIX,
  HOME_NOTES_CACHE_PREFIX,
  loadBoardNotes,
  loadFeedStories,
  loadHomeBoardNotes,
  loadLatestStory,
  peekFeedStories,
  peekFeedStoriesLoose,
  peekLatestStory,
  putFeedStories,
} from './pageData.ts'

afterEach(() => {
  requestCache.deleteByPrefix(FEED_STORIES_CACHE_PREFIX)
  requestCache.deleteByPrefix(HOME_NOTES_CACHE_PREFIX)
  requestCache.deleteByPrefix(BOARD_NOTES_CACHE_PREFIX)
})

describe('feedStoriesCacheKey', () => {
  it('一份源一把钥匙', () => {
    assert.equal(feedStoriesCacheKey(7), 'phantasi:feed-stories:7')
  })
})

describe('peek / put feed stories', () => {
  const items = [
    {
      id: 1,
      title: 'a',
      summary: null,
      image: null,
      published_at: 1,
      is_read: false,
    },
  ]

  it('写下就能读回，换戳当失效', async () => {
    putFeedStories(3, 9, items)
    assert.deepEqual(peekFeedStories(3, 9), items)
    assert.equal(peekFeedStories(3, 10), null)
    assert.deepEqual(peekFeedStoriesLoose(3), items)
    assert.equal(peekLatestStory({ id: 3, recent_items: [] })?.id, 1)
    assert.equal(
      (await loadLatestStory({ id: 3, last_success_at: 9, recent_items: [] }))
        ?.id,
      1,
    )
  })
})

describe('并发同源请求合并', () => {
  it('带 signal 的调用也走缓存和在途合并，只打一次网', async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return Response.json({
        items: [{ id: 42, title: 'x', summary: null, image: null, published_at: 1, source_id: 11 }],
        total: 1,
        page: 1,
        per_page: 20,
      })
    }) as typeof fetch
    try {
      const a = new AbortController()
      const b = new AbortController()
      const [first, second] = await Promise.all([
        loadFeedStories(11, 5, a.signal),
        loadFeedStories(11, 5, b.signal),
      ])
      assert.equal(calls, 1)
      assert.equal(first[0]?.id, 42)
      assert.equal(second[0]?.id, 42)
      // 命中缓存不再打网
      await loadFeedStories(11, 5)
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('调用方中途放弃：结果丢掉，请求不重发', async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return Response.json({ items: [], total: 0, page: 1, per_page: 8 })
    }) as typeof fetch
    try {
      const controller = new AbortController()
      const pending = loadHomeBoardNotes([{ id: 1, source_type: 'note' }], controller.signal)
      controller.abort()
      await assert.rejects(pending, (err: Error) => err.name === 'AbortError')
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('笔记墙按笔记源拉已发布条目，不走首页精选分类', async () => {
    const original = globalThis.fetch
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return Response.json({
        items: [
          {
            id: 9,
            title: '已见',
            summary: null,
            image: null,
            published_at: 20,
            source_id: 3,
            is_starred: false,
          },
        ],
        total: 1,
        page: 1,
        per_page: 100,
      })
    }) as typeof fetch
    try {
      const notes = await loadBoardNotes([
        { id: 3, source_type: 'note' },
        { id: 8, source_type: 'rss' },
      ])
      assert.equal(notes.length, 1)
      assert.equal(notes[0]?.id, 9)
      assert.match(urls[0] ?? '', /source_id=3/)
      assert.doesNotMatch(urls[0] ?? '', /category=/)
    } finally {
      globalThis.fetch = original
    }
  })
})
