import type { AppNotification } from './notificationApi'
import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'
import { apiService } from './api'
import { federationApi } from './federationApi'
import { runFederationInviteAction, runSeoReviewApply } from './notificationActions'

const notification = (metadata: AppNotification['metadata']) => ({ metadata }) as AppNotification

afterEach(() => mock.restoreAll())

for (const [kind, action, method, key] of [
  ['room_invite', 'accept', 'acceptRoomInvite', 'room_id'],
  ['room_invite', 'reject', 'rejectRoomInvite', 'room_id'],
  ['channel_invite', 'accept', 'acceptChannel', 'channel_id'],
  ['channel_invite', 'reject', 'closeChannel', 'channel_id'],
] as const) {
  test(`${kind} ${action} calls the matching endpoint once`, async () => {
    const call = mock.method(federationApi, method, async () => ({}))
    await runFederationInviteAction(notification({ kind, [key]: 'target' }), action)
    assert.deepEqual(call.mock.calls.map(entry => entry.arguments), [['target']])
  })
}

test('legacy invites infer their target from the available identifier', async () => {
  const room = mock.method(federationApi, 'acceptRoomInvite', async () => ({}))
  const channel = mock.method(federationApi, 'acceptChannel', async () => ({}))
  await runFederationInviteAction(notification({ room_id: 'room' }), 'accept')
  await runFederationInviteAction(notification({ channel_id: 'channel' }), 'accept')
  assert.deepEqual(room.mock.calls[0].arguments, ['room'])
  assert.deepEqual(channel.mock.calls[0].arguments, ['channel'])
})

test('invalid invites and unsupported actions cannot issue a request', async () => {
  const post = mock.method(apiService, 'post', async () => ({}))
  await assert.rejects(runFederationInviteAction(notification({ kind: 'room_invite' }), 'accept'))
  await assert.rejects(runFederationInviteAction(notification({ kind: 'channel_invite' }), 'reject'))
  await assert.rejects(runFederationInviteAction(notification({ room_id: 'room' }), 'unsupported'))
  assert.equal(post.mock.callCount(), 0)
})

test('SEO apply sends only supported nonempty draft fields', async () => {
  const post = mock.method(apiService, 'post', async () => ({}))
  await runSeoReviewApply(notification({ site_description: 'Description', site_keywords: '  ', site_ai_intro: 'Intro', unrelated: 'ignore' }))
  assert.deepEqual(post.mock.calls[0].arguments, ['/seo/apply-copy', { site_description: 'Description', site_ai_intro: 'Intro' }])
  await assert.rejects(runSeoReviewApply(notification({ site_keywords: '' })))
  assert.equal(post.mock.callCount(), 1)
})
