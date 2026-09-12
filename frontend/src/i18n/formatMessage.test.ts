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

  it('pluralizes English countable nouns', () => {
    const minutes =
      '{minutes, plural, one {# minute ago} other {# minutes ago}}'
    assert.equal(formatMessage('en-US', minutes, { minutes: 1 }), '1 minute ago')
    assert.equal(
      formatMessage('en-US', minutes, { minutes: 3 }),
      '3 minutes ago',
    )
    const sites = '{count, plural, one {# site} other {# sites}}'
    assert.equal(formatMessage('en-US', sites, { count: 1 }), '1 site')
    assert.equal(formatMessage('en-US', sites, { count: 4 }), '4 sites')
  })

  it('fills remaining tokens after a plural branch', () => {
    const tpl =
      'Showing {shown, plural, one {# item} other {# items}} from {total}'
    assert.equal(
      formatMessage('en-US', tpl, { shown: 1, total: 9 }),
      'Showing 1 item from 9',
    )
  })
})
