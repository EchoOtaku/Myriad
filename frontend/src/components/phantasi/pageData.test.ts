import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { requestCache } from '../../utils/requestCache.ts'
import {
  BOARD_NOTES_CACHE_PREFIX,
  FEED_STORIES_CACHE_PREFIX,
  feedStoriesCacheKey,
  loadBoardNotes,
  loadFeedStories,
  loadLatestStory,
  peekFeedStories,
  peekFeedStoriesLoose,
  peekLatestStory,
  putFeedStories,
} from './pageData.ts'

afterEach(() => {
  requestCache.deleteByPrefix(FEED_STORIES_CACHE_PREFIX)
  requestCache.deleteByPrefix(BOARD_NOTES_CACHE_PREFIX)
})

describe('feedStoriesCacheKey', () => {
  it('一份源一把钥匙', () => {
    assert.equal(feedStoriesCacheKey(7), 'phantasi:feed-stories:7:0')
    assert.equal(feedStoriesCacheKey(7, 9), 'phantasi:feed-stories:7:9')
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
      const pending = loadBoardNotes([{ id: 1, source_type: 'note' }], controller.signal)
      controller.abort()
      await assert.rejects(pending, (err: Error) => err.name === 'AbortError')
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('笔记墙按笔记源拉已发布条目，不带分类筛选', async () => {
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

  it('笔记墙逐页透传不透明游标并合并结果', async () => {
    const original = globalThis.fetch
    const urls: URL[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://test.invalid')
      urls.push(url)
      const second = url.searchParams.has('cursor')
      return Response.json({
        items: [{
          id: second ? 11 : 12,
          title: second ? 'older' : 'newer',
          summary: null,
          image: null,
          published_at: second ? 10 : 20,
          source_id: 31,
        }],
        total: second ? 0 : 2,
        page: 1,
        per_page: 100,
        next_cursor: second ? null : 'us:1700000000123456:12',
      })
    }) as typeof fetch
    try {
      const notes = await loadBoardNotes([{ id: 31, source_type: 'note' }])
      assert.deepEqual(notes.map(note => note.id), [12, 11])
      assert.equal(urls.length, 2)
      assert.equal(urls[1]?.searchParams.get('cursor'), 'us:1700000000123456:12')
    } finally {
      globalThis.fetch = original
    }
  })

  it('笔记墙遇到重复游标会停止而不是无限请求', async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return Response.json({
        items: [],
        total: 0,
        page: 1,
        per_page: 100,
        next_cursor: 'repeat-token',
      })
    }) as typeof fetch
    try {
      await assert.rejects(
        loadBoardNotes([{ id: 32, source_type: 'note' }]),
        /repeated cursor/,
      )
      assert.equal(calls, 2)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('progressive note pages', () => {
  it('publishes the first page before a slow second page and stops after cancellation', async () => {
    const original = globalThis.fetch
    const second = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    const snapshots: number[][] = []
    const controller = new AbortController()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls === 2) { started.resolve(); return second.promise }
      return Response.json({ items: [{ id: 101, source_id: 91, title: 'new', published_at: 2 }], next_cursor: 'second', per_page: 100, total: 300 })
    }) as typeof fetch
    try {
      const pending = loadBoardNotes([{ id: 91, source_type: 'note' }], controller.signal, (notes) => snapshots.push(notes.map(note => note.id)))
      const result = pending.catch(error => error)
      await started.promise
      assert.deepEqual(snapshots, [[101]])
      controller.abort()
      second.resolve(Response.json({ items: [{ id: 100, source_id: 91, title: 'old', published_at: 1 }], next_cursor: 'third', per_page: 100, total: 0 }))
      assert.equal((await result).name, 'AbortError')
      assert.equal(calls, 2)
      assert.deepEqual(snapshots, [[101]])
    } finally {
      controller.abort()
      second.resolve(Response.json({ items: [], next_cursor: null }))
      globalThis.fetch = original
    }
  })
})
