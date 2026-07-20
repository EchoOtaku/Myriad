/**
 *   pnpm exec tsx --test src/tapp/runtime/sessionUserFallback.test.ts
 */
/* eslint-disable test/no-import-node-test -- node:test */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { roleFromSessionSnapshot } from './sessionUserFallback.ts'
import type { SessionUserSnapshot } from './sessionUserFallback.ts'

describe('roleFromSessionSnapshot', () => {
  it('returns guest for null', () => {
    assert.equal(roleFromSessionSnapshot(null), 'guest')
  })

  it('returns user/admin from snapshot', () => {
    const user: SessionUserSnapshot = {
      id: 'user_1',
      username: 'alice',
      isAdmin: false,
      role: 'user',
      authenticated: true,
    }
    assert.equal(roleFromSessionSnapshot(user), 'user')
    assert.equal(
      roleFromSessionSnapshot({ ...user, isAdmin: true, role: 'admin' }),
      'admin',
    )
  })
})
