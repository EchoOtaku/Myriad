import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clipPaintedBatches,
  coverFeedIndices,
  expandFeedCover,
  extendPaintedRange,
  FEEDS_ARTICLE_MAX,
  FRIENDS_STORY_MAX,
  isAggregateFeedId,
  isInboxFeedSource,
  isLatestFeedId,
  isTopicFeedId,
  LATEST_FEED_ID,
  LATEST_FEED_STACK,
  latestFeedStackFaces,
  latestFeedStories,
  latestStoryPreview,
  railGroupSourceCount,
  reuseFeedStories,
  sameFeedStory,
  shuffleBySeed,
  sourceColumnStarts,
  sourceScrollStarts,
  stackFaceWindow,
  stitchStoriesBySources,
  storiesForSource,
  storiesFromSources,
  storyColumnLeads,
  storyColumnShift,
  storyRailGroup,
  storyRailSlots,
  storySlotAtColumn,
  storySlotsByColumn,
  toFeedStory,
  topicFeedId,
  topicFeedStories,
} from './feedStories.ts'
import { makeItem, makePreview, makeSource } from './fixtures.ts'

describe('toFeedStory', () => {
  it('只收轨上文章卡要的字段', () => {
    const story = toFeedStory(
      makeItem({
        id: 9,
        title: 's9',
        source_name: '源',
        source_icon: '/i.png',
        author: 'a',
      }),
    )
    assert.deepEqual(story, {
      id: 9,
      title: 's9',
      summary: story.summary,
      image: story.image,
      published_at: story.published_at,
      is_read: false,
      is_starred: false,
      topic: null,
      author: 'a',
      source_id: 1,
      source_name: '源',
      source_icon: '/i.png',
      guid: story.guid,
    })
    assert.match(story.guid ?? '', /^guid-/)
    assert.equal(FEEDS_ARTICLE_MAX, 20)
    assert.equal(FRIENDS_STORY_MAX, 12)
    assert.equal(LATEST_FEED_ID, -1)
    assert.equal(isLatestFeedId(-1), true)
    assert.equal(isLatestFeedId('-1'), true)
    assert.equal(isLatestFeedId(8), false)
    assert.equal(topicFeedId(0), -2)
    assert.equal(topicFeedId(1), -3)
    assert.equal(isTopicFeedId(-2), true)
    assert.equal(isTopicFeedId(-1), false)
    assert.equal(isAggregateFeedId(-3), true)
    assert.equal(isAggregateFeedId(8), false)
    assert.equal(isInboxFeedSource({ source_type: 'rss' }), true)
    assert.equal(isInboxFeedSource({ source_type: 'note' }), false)
    assert.equal(isInboxFeedSource({ source_type: 'link' }), false)
  })
})

const pool = [
  makeSource({
    id: 8,
    name: '甲',
    icon: '/a.png',
    recent_items: [makePreview({ id: 1, title: '旧', published_at: 10 })],
  }),
  makeSource({
    id: 9,
    name: '乙',
    icon: '/b.png',
    recent_items: [
      makePreview({ id: 2, title: '新', published_at: 20 }),
      makePreview({ id: 2, title: '重复', published_at: 30 }),
    ],
  }),
]

describe('latestFeedStories', () => {
  it('按时间混排，去重，跳过笔记和入口型，rail_group 标成最新卡', () => {
    const sources = [
      makeSource({
        id: 8,
        name: '甲',
        icon: '/a.png',
        recent_items: [
          makePreview({ id: 1, title: '旧', published_at: 10 }),
          makePreview({ id: 4, title: '重复', published_at: 40 }),
        ],
      }),
      makeSource({
        id: 9,
        name: '乙',
        icon: '/b.png',
        recent_items: [
          makePreview({ id: 2, title: '中', published_at: 20 }),
          makePreview({ id: 4, title: '重复', published_at: 40 }),
        ],
      }),
      makeSource({
        id: 3,
        name: '笔记',
        source_type: 'note',
        recent_items: [makePreview({ id: 9, title: '笔记文', published_at: 90 })],
      }),
      makeSource({
        id: 4,
        name: '友链',
        source_type: 'link',
        recent_items: [makePreview({ id: 8, title: '入口', published_at: 80 })],
      }),
    ]
    const fetched = new Map([
      [
        9,
        [
          toFeedStory(
            makeItem({
              id: 5,
              title: '乙全文',
              source_id: 9,
              published_at: 50,
            }),
          ),
        ],
      ],
    ])
    const stories = latestFeedStories(sources, fetched)
    assert.deepEqual(
      stories.map((story) => ({
        id: story.id,
        title: story.title,
        source_id: story.source_id,
        rail_group: story.rail_group,
      })),
      [
        { id: 5, title: '乙全文', source_id: 9, rail_group: LATEST_FEED_ID },
        { id: 4, title: '重复', source_id: 8, rail_group: LATEST_FEED_ID },
        { id: 1, title: '旧', source_id: 8, rail_group: LATEST_FEED_ID },
      ],
    )
    assert.equal(storyRailGroup(stories[0]!), LATEST_FEED_ID)
    assert.equal(
      latestFeedStories(sources, fetched, 2)
        .map((story) => story.id)
        .join(','),
      '5,4',
    )
  })

  it('拼到源轨前面时整块占最新卡的列，不按原文源拆开', () => {
    const mix = latestFeedStories(pool, new Map())
    const rest = stitchStoriesBySources(pool, new Map(), 0, 1)
    const slots = storyRailSlots([...mix, ...rest])
    assert.deepEqual(sourceColumnStarts(slots).map((block) => block.id), [
      LATEST_FEED_ID,
      8,
      9,
    ])
    assert.equal(slots[0]?.story.source_id, 9)
    assert.equal(storyRailGroup(slots[0]!.story), LATEST_FEED_ID)
  })
})

describe('topicFeedStories', () => {
  it('只收该主题，rail_group 标成主题卡，空主题不出卡列', () => {
    const rustId = topicFeedId(0)
    const sources = [
      makeSource({
        id: 8,
        name: '甲',
        recent_items: [
          makePreview({
            id: 1,
            title: '旧 Rust',
            published_at: 10,
            topic: 'Rust',
          }),
          makePreview({
            id: 4,
            title: 'AI 文',
            published_at: 40,
            topic: 'AI',
          }),
        ],
      }),
      makeSource({
        id: 9,
        name: '乙',
        recent_items: [
          makePreview({
            id: 2,
            title: '新 Rust',
            published_at: 20,
            topic: 'Rust',
          }),
        ],
      }),
      makeSource({
        id: 3,
        name: '笔记',
        source_type: 'note',
        recent_items: [
          makePreview({
            id: 9,
            title: '笔记 Rust',
            published_at: 90,
            topic: 'Rust',
          }),
        ],
      }),
    ]
    const stories = topicFeedStories(sources, new Map(), 'Rust', rustId)
    assert.deepEqual(
      stories.map((story) => ({
        id: story.id,
        title: story.title,
        source_id: story.source_id,
        rail_group: story.rail_group,
      })),
      [
        {
          id: 2,
          title: '新 Rust',
          source_id: 9,
          rail_group: rustId,
        },
        {
          id: 1,
          title: '旧 Rust',
          source_id: 8,
          rail_group: rustId,
        },
      ],
    )
    assert.equal(railGroupSourceCount(stories, rustId), 2)
    assert.deepEqual(topicFeedStories(sources, new Map(), '  ', rustId), [])
    const mix = latestFeedStories(sources, new Map())
    const rest = stitchStoriesBySources(sources, new Map(), 0, 1)
    const slots = storyRailSlots([...mix, ...stories, ...rest])
    assert.deepEqual(sourceColumnStarts(slots).map((block) => block.id), [
      LATEST_FEED_ID,
      rustId,
      8,
      9,
    ])
  })
})

describe('latestFeedStackFaces', () => {
  it('混排先露的源在前，笔记和入口型不进，窗口按偏移轮', () => {
    const sources = [
      makeSource({ id: 3, name: '笔记', source_type: 'note', icon: '/n.png' }),
      makeSource({ id: 8, name: '甲', icon: '/a.png', theme_color: '#111111' }),
      makeSource({ id: 9, name: '乙', icon: '/b.png', theme_color: '#222222' }),
      makeSource({ id: 4, name: '友链', source_type: 'link', icon: '/l.png' }),
      makeSource({ id: 7, name: '丙', icon: '/c.png' }),
    ]
    const faces = latestFeedStackFaces(sources, [
      {
        id: 1,
        title: '乙新',
        summary: null,
        image: null,
        published_at: 20,
        is_read: false,
        source_id: 9,
        source_name: '乙',
        source_icon: '/b.png',
        rail_group: LATEST_FEED_ID,
      },
      {
        id: 2,
        title: '甲旧',
        summary: null,
        image: null,
        published_at: 10,
        is_read: false,
        source_id: 8,
        source_name: '甲',
        source_icon: '/a.png',
        rail_group: LATEST_FEED_ID,
      },
      {
        id: 9,
        title: '笔记文',
        summary: null,
        image: null,
        published_at: 90,
        is_read: false,
        source_id: 3,
        source_name: '笔记',
        source_icon: '/n.png',
        rail_group: LATEST_FEED_ID,
      },
    ])
    assert.deepEqual(
      faces.map((face) => face.key),
      ['9', '8', '7'],
    )
    assert.equal(faces[0]?.src, '/b.png')
    assert.equal(faces[0]?.mark, '乙')
    assert.equal(LATEST_FEED_STACK, 3)
    assert.deepEqual(
      stackFaceWindow(faces, 0).map((face) => face.key),
      ['9', '8', '7'],
    )
    assert.deepEqual(
      stackFaceWindow(['a', 'b', 'c', 'd'], 1, 3),
      ['b', 'c', 'd'],
    )
    assert.deepEqual(stackFaceWindow(['a', 'b'], 4, 3), ['a', 'b'])
    const noIcon = latestFeedStackFaces(
      [makeSource({ id: 8, name: '甲', icon: null })],
      [
        {
          id: 1,
          title: '带图',
          summary: null,
          image: '/article.jpg',
          published_at: 20,
          is_read: false,
          source_id: 8,
          source_name: '甲',
          source_icon: null,
          rail_group: LATEST_FEED_ID,
        },
      ],
    )
    assert.equal(noIcon[0]?.src, null)
    assert.equal(noIcon[0]?.mark, '甲')
  })
})

describe('storiesFromSources', () => {
  it('把各源预览收成一条轨，同 id 只留一份，按种子随机', () => {
    const stories = storiesFromSources(pool, 0.42)
    assert.deepEqual(
      new Set(stories.map((story) => story.id)),
      new Set([1, 2]),
    )
    assert.equal(stories.find((story) => story.id === 2)?.source_name, '乙')
  })

  it('同一颗种子顺序稳定', () => {
    assert.deepEqual(
      storiesFromSources(pool, 0.3).map((story) => story.id),
      storiesFromSources(pool, 0.3).map((story) => story.id),
    )
  })
})

describe('shuffleBySeed', () => {
  const items = [1, 2, 3, 4, 5].map((id) => ({ id }))

  it('同一颗种子顺序稳定，集合不变', () => {
    const once = shuffleBySeed(items, 0.42).map((item) => item.id)
    assert.deepEqual(
      shuffleBySeed(items, 0.42).map((item) => item.id),
      once,
    )
    assert.deepEqual([...once].toSorted((a, b) => a - b), [1, 2, 3, 4, 5])
  })

  it('换种子会换顺序', () => {
    assert.notDeepEqual(
      shuffleBySeed(items, 0.42).map((item) => item.id),
      shuffleBySeed(items, 0.91).map((item) => item.id),
    )
  })
})

describe('feed span / stitch', () => {
  it('覆盖只增不减，焦点附近预取后面的源', () => {
    assert.deepEqual(coverFeedIndices([], 0, 5, 2), [0, 1, 2])
    assert.deepEqual(coverFeedIndices([0, 1, 2], 4, 5, 2), [0, 1, 2, 3, 4, 5])
    assert.deepEqual(expandFeedCover([0, 1], 1, 5), [0, 1, 2])
    assert.deepEqual(expandFeedCover([0, 1], -1, 5), [0, 1])
  })

  it('按源顺序拼接，不混时间', () => {
    const fetched = new Map([
      [9, [toFeedStory(makeItem({ id: 20, title: '乙新', source_id: 9 }))]],
    ])
    const stories = stitchStoriesBySources(pool, fetched, 0, 1)
    assert.deepEqual(
      stories.map((story) => ({ id: story.id, source_id: story.source_id })),
      [
        { id: 1, source_id: 8 },
        { id: 20, source_id: 9 },
      ],
    )
  })

  it('每个源占自己的列，不把下一源叠到上一源底下', () => {
    const stories = [
      { id: 1, title: '甲1', source_id: 8 },
      { id: 2, title: '甲2', source_id: 8 },
      { id: 3, title: '甲3', source_id: 8 },
      { id: 4, title: '乙1', source_id: 9 },
      { id: 5, title: '乙2', source_id: 9 },
    ]
    assert.equal(storyRailSlots(stories).at(-1)?.column, 3)
    assert.deepEqual(
      storyRailSlots(stories).map((slot) => ({
        id: slot.story.id,
        column: slot.column,
        row: slot.row,
      })),
      [
        { id: 1, column: 1, row: 1 },
        { id: 2, column: 2, row: 1 },
        { id: 3, column: 1, row: 2 },
        { id: 4, column: 3, row: 1 },
        { id: 5, column: 3, row: 2 },
      ],
    )
    assert.deepEqual(sourceColumnStarts(storyRailSlots(stories)), [
      { id: 8, column: 1 },
      { id: 9, column: 3 },
    ])
    assert.deepEqual(sourceScrollStarts(sourceColumnStarts(storyRailSlots(stories)), 280), [
      { id: 8, start: 0 },
      { id: 9, start: 560 },
    ])
    const grown = [
      { id: 1, title: '甲1', source_id: 8 },
      { id: 2, title: '甲2', source_id: 8 },
      { id: 3, title: '甲3', source_id: 8 },
      { id: 6, title: '甲4', source_id: 8 },
      { id: 7, title: '甲5', source_id: 8 },
      { id: 4, title: '乙1', source_id: 9 },
      { id: 5, title: '乙2', source_id: 9 },
    ]
    assert.equal(
      storyColumnShift(storyRailSlots(stories), storyRailSlots(grown), 3),
      1,
    )
    const slots = storyRailSlots(stories)
    assert.equal(storyRailSlots(stories, slots), slots)
    const starts = sourceColumnStarts(slots)
    assert.equal(sourceColumnStarts(slots, starts), starts)
    const byCol = storySlotsByColumn(slots)
    assert.equal(storySlotsByColumn(slots, byCol), byCol)
    const other = slots.find((slot) => slot.column !== slots[0]?.column)
    const shifted = slots.map((slot, i) => (i === 0 ? { ...slot } : slot))
    const nextByCol = storySlotsByColumn(shifted, byCol)
    assert.notEqual(nextByCol, byCol)
    if (other) assert.equal(nextByCol.get(other.column), byCol.get(other.column))
    const cols = extendPaintedRange([], 0, 0, 1, 2, (col) => col, true)
    assert.deepEqual(cols, [1, 2])
    const widerCols = extendPaintedRange(cols, 1, 2, 1, 4, (col) => col)
    assert.equal(widerCols[0], 1)
    assert.equal(widerCols[1], 2)
    assert.deepEqual(widerCols.slice(2), [3, 4])
    assert.equal(extendPaintedRange(widerCols, 1, 4, 1, 4, (col) => col), widerCols)
    assert.deepEqual(extendPaintedRange(widerCols, 1, 4, 2, 4, (col) => col), [2, 3, 4])
    const nodes = extendPaintedRange([], 0, 0, 1, 4, (col) => ({ col }), true)
    const slid = extendPaintedRange(nodes, 1, 4, 2, 4, (col) => ({ col }))
    assert.equal(slid[0], nodes[1])
    assert.equal(slid[1], nodes[2])
    assert.equal(slid[2], nodes[3])
    const shrunk = extendPaintedRange(nodes, 1, 4, 1, 2, (col) => ({ col }))
    assert.equal(shrunk[0], nodes[0])
    assert.equal(shrunk[1], nodes[1])
    const prepend = extendPaintedRange(nodes, 1, 4, 0, 4, (col) => ({ col }))
    assert.equal(prepend[1], nodes[0])
    assert.equal(prepend[0]?.col, 0)
    const slidBoth = extendPaintedRange(nodes, 1, 4, 2, 6, (col) => ({ col }))
    assert.equal(slidBoth[0], nodes[1])
    assert.equal(slidBoth[2], nodes[3])
    assert.equal(slidBoth[3]?.col, 5)
    const a = { col: 1 }
    const b = { col: 2 }
    const c = { col: 3 }
    const d = { col: 4 }
    const e = { col: 5 }
    const f = { col: 6 }
    const g = { col: 7 }
    const h = { col: 8 }
    const all = [a, b, c, d, e, f, g, h]
    const left = { from: 1, to: 4, nodes: [a, b, c, d] }
    const right = { from: 5, to: 8, nodes: [e, f, g, h] }
    const clipped = clipPaintedBatches([left, right], 3, 8, all.slice(2))
    assert.equal(clipped[0]?.keep, null)
    assert.equal(clipped[0]?.from, 3)
    assert.equal(clipped[0]?.to, 4)
    assert.equal(clipped[0]?.nodes[0], c)
    assert.equal(clipped[1]?.keep, right)
    assert.equal(clipped[1]?.nodes, right.nodes)
    const kept = clipPaintedBatches([left, right], 1, 8, all)
    assert.equal(kept[0]?.keep, left)
    assert.equal(kept[1]?.keep, right)
    assert.deepEqual(
      extendPaintedRange(widerCols, 1, 4, 1, 4, (col) => col + 10, true),
      [11, 12, 13, 14],
    )
    const leads = storyColumnLeads(slots)
    assert.equal(storySlotAtColumn(slots, 1, leads)?.story.id, 1)
    assert.equal(storySlotAtColumn(slots, 2, leads)?.story.id, 2)
    assert.equal(storySlotAtColumn(slots, 9, leads), undefined)
  })
})

describe('sameFeedStory / reuseFeedStories', () => {
  it('字段都一样才算同一张，拼轨时沿用旧对象', () => {
    const first = toFeedStory(makeItem({ id: 1, title: '甲', source_id: 8 }))
    const same = { ...first }
    const starred = { ...first, is_starred: true }
    assert.equal(sameFeedStory(first, same), true)
    assert.equal(sameFeedStory(first, starred), false)
    const prev = [first]
    const kept = reuseFeedStories(prev, [same])
    assert.equal(kept[0], first)
    assert.equal(kept, prev)
    const next = reuseFeedStories([first], [starred])
    assert.equal(next[0], starred)
    const mix = { ...first, rail_group: LATEST_FEED_ID }
    assert.equal(sameFeedStory(first, mix), false)
    const both = reuseFeedStories([first, mix], [mix, first])
    assert.equal(both[0], mix)
    assert.equal(both[1], first)
  })
})

describe('storiesForSource', () => {
  it('已拉到的全文盖过源上的预览，并写上当前源名', () => {
    const preview = makePreview({ id: 1, title: '旧' })
    const fetched = {
      id: 10,
      items: [toFeedStory(makeItem({ id: 2, title: '新', source_id: 10 }))],
    }
    const stories = storiesForSource(fetched, {
      id: 10,
      name: '当前源',
      icon: '/now.png',
      recent_items: [preview],
    })
    assert.deepEqual(
      stories.map((story) => ({
        id: story.id,
        title: story.title,
        source_id: story.source_id,
        source_name: story.source_name,
        source_icon: story.source_icon,
      })),
      [{ id: 2, title: '新', source_id: 10, source_name: '当前源', source_icon: '/now.png' }],
    )
  })

  it('还没拉到或拉空时用预览', () => {
    const preview = makePreview({ id: 3, title: '预览' })
    const stories = storiesForSource(null, {
      id: 10,
      name: '当前源',
      icon: null,
      recent_items: [preview],
    })
    assert.equal(stories[0]?.id, 3)
    assert.equal(stories[0]?.source_name, '当前源')
  })

  it('笔记源把 source_type 写上，卡面用来源换成站点', () => {
    const stories = storiesForSource(null, {
      id: 3,
      name: '笔记',
      icon: '/n.png',
      source_type: 'note',
      recent_items: [makePreview({ id: 4, title: '近文' })],
    })
    assert.equal(stories[0]?.source_type, 'note')
    assert.equal(stories[0]?.source_name, '笔记')
  })

  it('没有焦点源不收', () => {
    assert.deepEqual(
      storiesForSource({ id: 1, items: [toFeedStory(makeItem())] }, null),
      [],
    )
  })
})

describe('latestStoryPreview', () => {
  it('宽松缓存盖过源上预览', () => {
    const loose = [makePreview({ id: 2, title: 'cached' })]
    const recent = [makePreview({ id: 1, title: 'recent' })]
    assert.equal(latestStoryPreview(loose, recent)?.id, 2)
    assert.equal(latestStoryPreview(null, recent)?.id, 1)
    assert.equal(latestStoryPreview(null, null), undefined)
  })
})
