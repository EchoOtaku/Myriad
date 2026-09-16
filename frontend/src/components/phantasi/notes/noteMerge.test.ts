import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeNoteField, mergeNoteText } from './noteMerge.ts'

describe('mergeNoteText', () => {
  it('只改一边就取那边', () => {
    assert.equal(mergeNoteText('a\nb', 'a\nb', 'a\nB'), 'a\nB')
    assert.equal(mergeNoteText('a\nb', 'A\nb', 'a\nb'), 'A\nb')
  })

  it('不同行两边都留', () => {
    assert.equal(mergeNoteText('a\nb\nc', 'A\nb\nc', 'a\nb\nC'), 'A\nb\nC')
  })

  it('各自往后加一行', () => {
    assert.equal(mergeNoteText('a', 'a\n一', 'a\n二'), 'a\n一\n二')
  })

  it('同一行冲突两行都留', () => {
    assert.equal(mergeNoteText('x', '左', '右'), '左\n右')
  })
})

describe('mergeNoteField', () => {
  it('没改的字段跟远端', () => {
    assert.equal(mergeNoteField('旧', '旧', '新'), '新')
    assert.equal(mergeNoteField('旧', '我的', '旧'), '我的')
  })
})

it('保留各作者插入段内部的重复行和空行', () => {
  assert.equal(mergeNoteText('anchor', 'anchor\nx\nx\n\n', 'anchor\ny'), 'anchor\nx\nx\n\n\ny')
})

it('一方替换基准行时保留另一方在这行之前插入的内容', () => {
  assert.equal(mergeNoteText('old', 'insert\nold', 'new'), 'insert\nnew')
  assert.equal(mergeNoteText('old', 'new', 'insert\nold'), 'insert\nnew')
})
