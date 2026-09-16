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

it('按基准位置合并重复行上的独立修改', () => {
  assert.equal(mergeNoteText('x\nx', 'X\nx', 'x\nY'), 'X\nY')
})

it('重复行的删除与另一位置的修改独立合并', () => {
  assert.equal(mergeNoteText('x\nx\nz', 'x\nz', 'x\nx\nZ'), 'x\nZ')
  assert.equal(mergeNoteText('x\nx', 'x', 'X\nx'), 'X')
})

it('重复锚点两侧的插入保持基准顺序', () => {
  assert.equal(mergeNoteText('x\nx', 'x\na\nx', 'x\nx\nb'), 'x\na\nx\nb')
})

it('相同替换仅保留一次，独立追加保留', () => {
  assert.equal(mergeNoteText('a\nb\nc', 'A\nb\nc', 'A\nb\nc\nd'), 'A\nb\nc\nd')
})

it('交叠修改保留双方，按local再remote排序', () => {
  assert.equal(mergeNoteText('a\nb\nc', 'L\nc', 'a\nR'), 'L\nc\na\nR')
})

it('较大变更有界回退，双方内容都保留', () => {
  const base = Array.from({ length: 1100 }, (_, i) => `base-${i}`).join('\n')
  const local = Array.from({ length: 1100 }, (_, i) => `local-${i}`).join('\n')
  const remote = Array.from({ length: 1100 }, (_, i) => `remote-${i}`).join('\n')
  assert.equal(mergeNoteText(base, local, remote), `${local}\n${remote}`)
})
