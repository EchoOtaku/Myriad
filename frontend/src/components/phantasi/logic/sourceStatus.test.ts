import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  workbenchSourceFetches,
  workbenchSourceStatus,
  workbenchSourceStatusTone,
} from './sourceStatus.ts'

const feed = {
  source_type: 'rss',
  enabled: true,
  last_error: null as string | null,
  error_count: 0,
  last_success_at: 100 as number | null,
}

describe('workbenchSourceFetches', () => {
  it('入口和笔记不抓', () => {
    assert.equal(workbenchSourceFetches({ source_type: 'link' }), false)
    assert.equal(workbenchSourceFetches({ source_type: 'note' }), false)
    assert.equal(workbenchSourceFetches({ source_type: 'rss' }), true)
    assert.equal(workbenchSourceFetches({ source_type: 'rsshub' }), true)
  })
})

describe('workbenchSourceStatus', () => {
  it('入口闲置；暂停优先于失败；刷新中盖过别的', () => {
    assert.equal(
      workbenchSourceStatus({ ...feed, source_type: 'link' }),
      'idle',
    )
    assert.equal(workbenchSourceStatus({ ...feed, enabled: false }), 'paused')
    assert.equal(
      workbenchSourceStatus({
        ...feed,
        enabled: false,
        last_error: 'x',
        error_count: 4,
      }),
      'paused',
    )
    assert.equal(workbenchSourceStatus(feed, true), 'refreshing')
  })

  it('连续失败、单次失败、还没抓过、正常', () => {
    assert.equal(
      workbenchSourceStatus({
        ...feed,
        last_error: 'x',
        error_count: 2,
        last_success_at: 10,
      }),
      'failed',
    )
    assert.equal(
      workbenchSourceStatus({
        ...feed,
        last_error: 'x',
        error_count: 1,
        last_success_at: 10,
      }),
      'error',
    )
    assert.equal(
      workbenchSourceStatus({
        ...feed,
        last_error: null,
        last_success_at: null,
      }),
      'pending',
    )
    assert.equal(workbenchSourceStatus(feed), 'ok')
  })
})

describe('workbenchSourceStatusTone', () => {
  it('闲置没有色，成败分开', () => {
    assert.equal(workbenchSourceStatusTone('idle'), null)
    assert.equal(workbenchSourceStatusTone('ok'), 'success')
    assert.equal(workbenchSourceStatusTone('paused'), 'warn')
    assert.equal(workbenchSourceStatusTone('error'), 'warn')
    assert.equal(workbenchSourceStatusTone('failed'), 'danger')
    assert.equal(workbenchSourceStatusTone('pending'), 'muted')
    assert.equal(workbenchSourceStatusTone('refreshing'), 'active')
  })
})
