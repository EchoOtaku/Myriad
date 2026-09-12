import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatMessage } from './formatMessage.ts'

describe('formatMessage', () => {
  it('fills simple tokens', () => {
    assert.equal(
      formatMessage('en-US', 'Hello {name}', { name: 'Ada' }),
      'Hello Ada',
    )
  })

  it('selects English plural branches', () => {
    const tpl = '{n, plural, one {# new item} other {# new items}}'
    assert.equal(formatMessage('en-US', tpl, { n: 1 }), '1 new item')
    assert.equal(formatMessage('en-US', tpl, { n: 3 }), '3 new items')
  })

  it('keeps a single Chinese form', () => {
    assert.equal(
      formatMessage('zh-CN', '{count, plural, other {# 篇}}', { count: 1 }),
      '1 篇',
    )
    assert.equal(
      formatMessage('zh-TW', '{count, plural, other {# 篇}}', { count: 8 }),
      '8 篇',
    )
  })

  it('honors exact =0', () => {
    assert.equal(
      formatMessage('en-US', '{n, plural, =0 {none} other {# left}}', { n: 0 }),
      'none',
    )
  })
})
