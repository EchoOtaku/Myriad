import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { daysAgo, makeItem, NOW } from './fixtures.ts'
import {
  clusterTopics,
  isPredefinedTopic,
  MAX_TOPIC_NAME_CHARS,
  normalizeTopicName,
  PREDEFINED_TOPICS,
  previewsToTopicItems,
  TOPIC_MIN_ITEMS,
  TOPIC_WINDOW_DAYS,
  topicDisplayName,
  topicHue,
  topicNameKey,
  topicSourceCount,
} from './topics.ts'

describe('leftover topic keys', () => {
  it('旧 10 个 key 仍能翻译上色，但不再是写入白名单', () => {
    assert.equal(PREDEFINED_TOPICS.length, 10)
    assert.equal(PREDEFINED_TOPICS.includes('other'), false)
    for (const key of PREDEFINED_TOPICS) {
      assert.ok(topicNameKey(key), `${key} 缺 nameKey`)
      assert.match(topicHue(key), /^#[0-9a-f]{6}$/i, `${key} 的 hue 不是 hex`)
      assert.equal(isPredefinedTopic(key), true)
    }
    assert.equal(isPredefinedTopic('Rust'), false)
    assert.equal(topicNameKey('Rust'), null)
    assert.match(topicHue('Rust'), /^hsl\(/)
  })
})

describe('normalizeTopicName', () => {
  it('空串不算主题，超长截断', () => {
    assert.equal(normalizeTopicName('  '), null)
    assert.equal(normalizeTopicName(' Rust '), 'Rust')
    const long = '字'.repeat(MAX_TOPIC_NAME_CHARS + 8)
    assert.equal([...normalizeTopicName(long)!].length, MAX_TOPIC_NAME_CHARS)
  })
})

describe('previewsToTopicItems', () => {
  it('手记源不进主题聚类', () => {
    const items = previewsToTopicItems([
      {
        id: 1,
        name: '手记',
        source_type: 'note',
        recent_items: [
          { id: 11, title: 'a', image: null, published_at: NOW, topic: '随笔' },
          { id: 12, title: 'b', image: null, published_at: NOW, topic: '随笔' },
          { id: 13, title: 'c', image: null, published_at: NOW, topic: '随笔' },
        ],
      },
      {
        id: 2,
        name: '订阅',
        source_type: 'rss',
        recent_items: [
          { id: 21, title: 'd', image: null, published_at: NOW, topic: 'Rust' },
        ],
      },
    ])
    assert.deepEqual(
      items.map((item) => item.id),
      [21],
    )
  })
})

describe('clusterTopics', () => {
  const rust = (over = {}) =>
    makeItem({ topic: 'Rust', published_at: daysAgo(3), ...over })

  it('不足 3 篇不成卡', () => {
    const two = [rust({ id: 1 }), rust({ id: 2 })]
    assert.deepEqual(clusterTopics(two, NOW), [])

    const three = [...two, rust({ id: 3 })]
    const out = clusterTopics(three, NOW)
    assert.equal(out.length, 1)
    assert.equal(out[0].key, 'Rust')
    assert.equal(out[0].nameKey, null)
    assert.equal(out[0].items.length, TOPIC_MIN_ITEMS)
  })

  it('窗口外的文章不算', () => {
    const items = [
      rust({ id: 1, published_at: daysAgo(1) }),
      rust({ id: 2, published_at: daysAgo(2) }),
      rust({ id: 3, published_at: daysAgo(TOPIC_WINDOW_DAYS + 1) }),
    ]
    assert.deepEqual(clusterTopics(items, NOW), [], '只剩 2 篇在窗口内')
  })

  it('topic 为空的文章不参与', () => {
    const items = [
      makeItem({ id: 1, topic: null }),
      makeItem({ id: 2, topic: undefined }),
      makeItem({ id: 3, topic: '  ' }),
      makeItem({ id: 4, topic: '' }),
    ]
    assert.deepEqual(clusterTopics(items, NOW), [])
  })

  it('任意非空名满 3 篇就能成卡', () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ id: i + 1, topic: '独立开发', published_at: daysAgo(i + 1) }),
    )
    const [topic] = clusterTopics(items, NOW)
    assert.equal(topic.key, '独立开发')
    assert.equal(topic.nameKey, null)
    assert.match(topic.hue, /^hsl\(/)
  })

  it('没有 published_at 的文章跳过（无法判断是否在窗口内）', () => {
    const items = [
      rust({ id: 1 }),
      rust({ id: 2 }),
      rust({ id: 3, published_at: null }),
    ]
    assert.deepEqual(clusterTopics(items, NOW), [])
  })

  it('组内按发布时间新→旧', () => {
    const items = [
      rust({ id: 1, published_at: daysAgo(9) }),
      rust({ id: 2, published_at: daysAgo(1) }),
      rust({ id: 3, published_at: daysAgo(5) }),
    ]
    const [topic] = clusterTopics(items, NOW)
    assert.deepEqual(topic.items.map((i) => i.id), [2, 3, 1])
  })

  it('主题按篇数降序，同篇数按名字稳定排序', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: 100 + i, topic: 'ai', published_at: daysAgo(i + 1) }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeItem({ id: 200 + i, topic: 'systems', published_at: daysAgo(i + 1) }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeItem({ id: 300 + i, topic: 'engineering', published_at: daysAgo(i + 1) }),
      ),
    ]
    const keys = clusterTopics(items, NOW).map((t) => t.key)
    assert.deepEqual(keys, ['ai', 'engineering', 'systems'])
    assert.deepEqual(clusterTopics(items.toReversed(), NOW).map((t) => t.key), keys)
  })

  it('聚类只看 item.topic，不重新猜', () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({
        id: i + 1,
        topic: 'ai',
        title: 'linux kernel tcp dns',
        published_at: daysAgo(i + 1),
      }),
    )
    const out = clusterTopics(items, NOW)
    assert.equal(out.length, 1)
    assert.equal(out[0].key, 'ai')
  })

  it('旧 key 仍带 leftover nameKey 与色相', () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ id: i + 1, topic: 'security', published_at: daysAgo(i + 1) }),
    )
    const [topic] = clusterTopics(items, NOW)
    assert.equal(topic.nameKey, topicNameKey('security'))
    assert.equal(topic.hue, topicHue('security'))
  })

  it('不改入参数组', () => {
    const items = [rust({ id: 1 }), rust({ id: 2 }), rust({ id: 3 })]
    const ids = items.map((i) => i.id)
    clusterTopics(items, NOW)
    assert.deepEqual(items.map((i) => i.id), ids)
  })
})

describe('topicSourceCount', () => {
  it('去重后的源数', () => {
    const items = [
      makeItem({ id: 1, source_id: 7, topic: 'oss', published_at: daysAgo(1) }),
      makeItem({ id: 2, source_id: 7, topic: 'oss', published_at: daysAgo(2) }),
      makeItem({ id: 3, source_id: 9, topic: 'oss', published_at: daysAgo(3) }),
    ]
    const [topic] = clusterTopics(items, NOW)
    assert.equal(topicSourceCount(topic), 2)
  })
})

describe('topicDisplayName', () => {
  it('旧 key 读 i18n，自建名原样显示', () => {
    assert.equal(
      topicDisplayName({ key: 'ai', nameKey: 'topicAi' }, { topicAi: '人工智能' }),
      '人工智能',
    )
    assert.equal(topicDisplayName({ key: 'ai' }, { topicAi: '人工智能' }), '人工智能')
    assert.equal(topicDisplayName({ key: 'ai', nameKey: 'topicAi' }, {}), 'ai')
    assert.equal(topicDisplayName({ key: 'Rust' }, { topicAi: '人工智能' }), 'Rust')
  })
})
