import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyCollabPeers,
  shouldApplyRemoteDoc,
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

it('无版本 edit 只更新在场状态，不应用文档快照', () => {
  assert.equal(shouldApplyRemoteDoc({ type: 'edit', peer_id: 'a', user_id: 1, title: '草稿', content_md: '旧快照', revision: 3 }, 2), false)
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

it('edit marks active typing and a presence heartbeat preserves the activity time', () => {
  const edit = applyCollabPeers([], { type: 'edit', peer_id: 'a', user_id: 1 })
  assert.equal(typeof edit[0]?.lastEditAt, 'number')
  const heartbeat = applyCollabPeers(edit, { type: 'presence', peer_id: 'a', user_id: 1 })
  assert.equal(heartbeat[0]?.lastEditAt, edit[0]?.lastEditAt)
})
