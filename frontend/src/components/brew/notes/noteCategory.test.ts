import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectNoteCategories,
  matchesNoteCategory,
  MAX_NOTE_CATEGORY_CHARS,
  normalizeNoteCategory,
  noteCategoryHue,
  noteCategoryLabel,
  noteStoryTopic,
} from './noteCategory.ts'

describe('normalizeNoteCategory', () => {
  it('空串不算分类，超长截断', () => {
    assert.equal(normalizeNoteCategory('  '), null)
    assert.equal(normalizeNoteCategory('随笔'), '随笔')
    const long = '字'.repeat(MAX_NOTE_CATEGORY_CHARS + 8)
    assert.equal(
      [...normalizeNoteCategory(long)!].length,
      MAX_NOTE_CATEGORY_CHARS,
    )
  })
})

describe('collectNoteCategories', () => {
  it('去重排序，丢掉预置源分类和空值', () => {
    assert.deepEqual(
      collectNoteCategories([
        { topic: '旅行' },
        { topic: ' 随笔 ' },
        { topic: '旅行' },
        { topic: '我' },
        { topic: '友情链接' },
        { topic: null },
        { topic: '' },
        { topic: '工程, 旅行' },
      ]),
      ['工程', '旅行', '随笔'],
    )
  })
})

describe('noteCategoryLabel / hue', () => {
  it('旧预置 key 仍用 i18n 名和色相，自建名原样显示', () => {
    assert.equal(
      noteCategoryLabel('ai', { topicAi: '人工智能' }),
      '人工智能',
    )
    assert.equal(noteCategoryLabel('随笔', { topicAi: '人工智能' }), '随笔')
    assert.ok(noteCategoryHue('ai')?.startsWith('#'))
    assert.match(noteCategoryHue('随笔'), /^hsl\(/)
    assert.deepEqual(noteStoryTopic('ai', { topicAi: '人工智能' }), {
      topic: '人工智能',
      hue: noteCategoryHue('ai'),
    })
    assert.deepEqual(noteStoryTopic(null, {}), { topic: null, hue: null })
  })
})

describe('matchesNoteCategory', () => {
  it('全部 / 指定 / 未归类', () => {
    assert.equal(matchesNoteCategory('随笔', null), true)
    assert.equal(matchesNoteCategory(null, null), true)
    assert.equal(matchesNoteCategory('随笔', '随笔'), true)
    assert.equal(matchesNoteCategory('旅行', '随笔'), false)
    assert.equal(matchesNoteCategory(null, ''), true)
    assert.equal(matchesNoteCategory('随笔', ''), false)
    assert.equal(matchesNoteCategory('工程, 旅行', '工程'), true)
    assert.equal(matchesNoteCategory('工程, 旅行', '旅行'), true)
    assert.equal(matchesNoteCategory('工程, 旅行', '随笔'), false)
    assert.equal(matchesNoteCategory('工程, 旅行', ''), false)
  })
})
