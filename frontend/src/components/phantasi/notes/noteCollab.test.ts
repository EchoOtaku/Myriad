import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyCollabPeers,
  shouldApplyRemoteDoc,
  shouldApplyRemoteEdit,
} from './noteCollab.ts'

describe('applyCollabPeers', () => {
  it('join 和 leave 维护名单', () => {
    const joined = applyCollabPeers([], {
      type: 'join',
      peer_id: 'a',
      user_id: 1,
    })
    assert.equal(joined.length, 1)
    assert.equal(
      applyCollabPeers(joined, { type: 'leave', peer_id: 'a', user_id: 1 }).length,
      0,
    )
  })

  it('presence 更新光标', () => {
    const joined = applyCollabPeers([], {
      type: 'join',
      peer_id: 'a',
      user_id: 1,
    })
    const next = applyCollabPeers(joined, {
      type: 'presence',
      peer_id: 'a',
      user_id: 1,
      cursor: 12,
    })
    assert.equal(next[0]?.cursor, 12)
  })

  it('忽略自己的事件', () => {
    assert.equal(
      applyCollabPeers([], { type: 'join', peer_id: 'me', user_id: 1 }, 'me')
        .length,
      0,
    )
  })

  it('edit 也跟着挪光标', () => {
    const joined = applyCollabPeers([], {
      type: 'join',
      peer_id: 'a',
      user_id: 1,
      name: 'Ada',
    })
    const next = applyCollabPeers(joined, {
      type: 'edit',
      peer_id: 'a',
      user_id: 1,
      cursor: 8,
      content_md: 'x',
    })
    assert.equal(next[0]?.cursor, 8)
    assert.equal(next[0]?.name, 'Ada')
  })
})

describe('shouldApplyRemoteEdit', () => {
  it('只收下别人正在打的正文', () => {
    assert.equal(
      shouldApplyRemoteEdit({
        type: 'edit',
        peer_id: 'a',
        user_id: 1,
        content_md: 'x',
      }),
      true,
    )
    assert.equal(
      shouldApplyRemoteEdit({ type: 'presence', peer_id: 'a', user_id: 1 }),
      false,
    )
  })
})

describe('shouldApplyRemoteDoc', () => {
  it('只收下更新的 revision', () => {
    assert.equal(
      shouldApplyRemoteDoc({ type: 'doc', peer_id: 'a', user_id: 1, revision: 3 }, 2),
      true,
    )
    assert.equal(
      shouldApplyRemoteDoc({ type: 'doc', peer_id: 'a', user_id: 1, revision: 2 }, 2),
      false,
    )
  })
})
