import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchEnterRule, matchSpaceRule } from './noteInputRules'

describe('matchSpaceRule', () => {
  it('井号数就是标题级别', () => {
    assert.deepEqual(matchSpaceRule('#'), { kind: 'heading', level: 1 })
    assert.deepEqual(matchSpaceRule('###'), { kind: 'heading', level: 3 })
    assert.equal(matchSpaceRule('#######'), null)
  })

  it('列表、任务、引用', () => {
    assert.deepEqual(matchSpaceRule('-'), { kind: 'bullet' })
    assert.deepEqual(matchSpaceRule('*'), { kind: 'bullet' })
    assert.deepEqual(matchSpaceRule('1.'), { kind: 'ordered' })
    assert.deepEqual(matchSpaceRule('[]'), { kind: 'task' })
    assert.deepEqual(matchSpaceRule('- [ ]'), { kind: 'task' })
    assert.deepEqual(matchSpaceRule('>'), { kind: 'quote' })
  })

  it('行上已有别的字就不触发', () => {
    assert.equal(matchSpaceRule('a -'), null)
    assert.equal(matchSpaceRule('2.'), null)
    assert.equal(matchSpaceRule(''), null)
  })
})

describe('matchEnterRule', () => {
  it('围栏带语言', () => {
    assert.deepEqual(matchEnterRule('```'), { kind: 'code', lang: '' })
    assert.deepEqual(matchEnterRule('```rust'), { kind: 'code', lang: 'rust' })
  })

  it('三个横线是分隔线', () => {
    assert.deepEqual(matchEnterRule('---'), { kind: 'divider' })
    assert.deepEqual(matchEnterRule('***'), { kind: 'divider' })
    assert.equal(matchEnterRule('--'), null)
  })
})
