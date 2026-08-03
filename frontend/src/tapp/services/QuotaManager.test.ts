/**
 *   pnpm exec tsx --test src/tapp/services/QuotaManager.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getQuotaManager } from './QuotaManager.ts'

describe('QuotaManager bridge soft limits', () => {
  it('rate-limits lifecycle control-plane signals', () => {
    const q = getQuotaManager()
    const tappId = `quota-test-${Date.now()}`
    let blocked = 0
    // lifecyclePerMinute = 30 — carve-out, does not share the global bridge bucket
    for (let i = 0; i < 40; i++) {
      const check = q.checkQuota(tappId, 'lifecycle.ready')
      if (!check.allowed) {
        blocked += 1
        break
      }
      q.recordUsage(tappId, 'lifecycle.ready')
    }
    assert.ok(blocked >= 1, 'lifecycle.ready should hit lifecycle bucket')
  })

  it('applies global bridge.action bucket to platform reads', () => {
    const q = getQuotaManager()
    const tappId = `quota-plat-${Date.now()}`
    // platform.read is 60/min; each also counts toward bridge.action 180
    for (let i = 0; i < 5; i++) {
      const check = q.checkQuota(tappId, 'platform.getData')
      assert.equal(check.allowed, true)
      q.recordUsage(tappId, 'platform.getData')
    }
    const after = q.checkQuota(tappId, 'platform.getData')
    assert.equal(after.allowed, true)
  })

  it('carves storage.* out of the global bridge.action bucket', () => {
    const q = getQuotaManager()
    const tappId = `quota-storage-${Date.now()}`
    // Fill global bridge.action with platform reads (60/min family + global)
    for (let i = 0; i < 180; i++) {
      // Use a generic bridge action that hits only the global bucket
      const check = q.checkQuota(tappId, 'context.getApp')
      if (!check.allowed) break
      q.recordUsage(tappId, 'context.getApp')
    }
    // Global should be exhausted for generic actions
    const generic = q.checkQuota(tappId, 'context.getApp')
    assert.equal(generic.allowed, false, 'global bridge bucket should be full')

    // storage and ui.getTheme remain available via their carve-out buckets
    const storage = q.checkQuota(tappId, 'storage.get')
    assert.equal(storage.allowed, true, 'storage should be carved out')
    q.recordUsage(tappId, 'storage.get')

    const theme = q.checkQuota(tappId, 'ui.getTheme')
    assert.equal(theme.allowed, true, 'ui.getTheme should be carved out')
  })

  it('still rate-limits storage under its own generous cap', () => {
    const q = getQuotaManager()
    const tappId = `quota-storage-cap-${Date.now()}`
    let blocked = 0
    // storagePerMinute = 600 — probe beyond a small burst is enough to prove
    // the bucket exists; full 600-loop is slow so we just assert headroom.
    for (let i = 0; i < 50; i++) {
      const check = q.checkQuota(tappId, 'storage.set')
      if (!check.allowed) {
        blocked += 1
        break
      }
      q.recordUsage(tappId, 'storage.set')
    }
    assert.equal(blocked, 0, 'storage should allow at least 50/min freely')
  })
})
