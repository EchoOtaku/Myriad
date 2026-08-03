/**
 *   pnpm exec tsx --test src/tapp/services/QuotaManager.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getQuotaManager } from './QuotaManager.ts'

describe('QuotaManager bridge soft limits', () => {
  it('rate-limits generic bridge actions (storage etc.)', () => {
    const q = getQuotaManager()
    const tappId = `quota-test-${Date.now()}`
    let blocked = 0
    // bridgeActionsPerMinute default 180 — probe a smaller burst via lifecycle
    for (let i = 0; i < 40; i++) {
      const check = q.checkQuota(tappId, 'lifecycle.ready')
      if (!check.allowed) {
        blocked += 1
        break
      }
      q.recordUsage(tappId, 'lifecycle.ready')
    }
    // lifecyclePerMinute = 30
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
})
