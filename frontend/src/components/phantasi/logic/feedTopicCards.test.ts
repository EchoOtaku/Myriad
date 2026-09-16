import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseFeedTopicCards,
  pickEnabledTopicCards,
  pickTopicCardPreviews,
} from './feedTopicCards.ts'

describe('parseFeedTopicCards', () => {
  it('读数组或 cards 对象，去空白去重', () => {
    assert.deepEqual(parseFeedTopicCards(['Rust', ' AI ', 'Rust', '']), [
      'Rust',
      'AI',
    ])
    assert.deepEqual(parseFeedTopicCards({ cards: ['Rust', 1, 'AI'] }), [
      'Rust',
      'AI',
    ])
    assert.deepEqual(parseFeedTopicCards(null), [])
    assert.deepEqual(parseFeedTopicCards(true), [])
  })
})

describe('pickEnabledTopicCards', () => {
  it('只留现有主题，顺序跟目录', () => {
    assert.deepEqual(
      pickEnabledTopicCards(['AI', 'Rust', 'Go'], new Set(['Rust', 'gone', 'AI'])),
      ['AI', 'Rust'],
    )
  })
})

describe('pickTopicCardPreviews', () => {
  it('只收该主题，按时间去重，最多三篇', () => {
    const items = [
      { id: 1, title: '旧', topic: 'Rust', published_at: 10 },
      { id: 2, title: '新', topic: 'Rust', published_at: 30 },
      { id: 2, title: '重复', topic: 'Rust', published_at: 30 },
      { id: 3, title: '中', topic: 'Rust', published_at: 20 },
      { id: 4, title: 'AI', topic: 'AI', published_at: 40 },
      { id: 5, title: '更早', topic: 'Rust', published_at: 5 },
    ]
    assert.deepEqual(
      pickTopicCardPreviews('Rust', items).map((item) => item.id),
      [2, 3, 1],
    )
    assert.deepEqual(pickTopicCardPreviews('  ', items), [])
  })
})
