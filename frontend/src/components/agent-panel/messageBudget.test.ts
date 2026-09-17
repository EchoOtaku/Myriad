import type { ChatMessage } from './engineTypes'
import assert from 'node:assert/strict'
import test from 'node:test'
import { boundMessage, HOT_MESSAGE_LIMIT, retainHotMessages } from './messageBudget'

const row = (i: number): ChatMessage => ({ id: String(i), sessionId: 's', role: 'assistant', content: 'hello', createdAt: new Date() })
test('hot history stays bounded while retaining an outstanding question', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(i))
  rows[0].taskExecution = { taskId: 'active', status: 'waiting', progress: 50, steps: [] }
  const hot = retainHotMessages(rows)
  assert.ok(hot.length <= HOT_MESSAGE_LIMIT)
  assert.equal(hot[0].id, '0')
  assert.equal(hot.at(-1)?.id, '999')
})
test('execution and result payloads have a budget without changing the reply', () => {
  const message = row(1)
  message.data = { workOffer: { input: 'do this' }, enormous: 'x'.repeat(1000000) }
  message.taskExecution = { taskId: 't', status: 'completed', progress: 100, steps: Array.from({ length: 10000 }, (_, i) => ({ id: String(i), name: 'step', status: 'completed' })) }
  const bounded = boundMessage(message)
  assert.equal(bounded.content, 'hello')
  assert.ok(JSON.stringify(bounded).length < 100000)
  assert.deepEqual((bounded.data as { workOffer: unknown }).workOffer, { input: 'do this' })
})

test('large replies exhaust the byte budget before the count budget', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ ...row(i), content: 'x'.repeat(131072) }))
  const hot = retainHotMessages(rows)
  assert.ok(JSON.stringify(hot).length * 2 <= 4 * 1024 * 1024)
  assert.equal(hot.at(-1)?.id, '119')
})

test('active long bodies never bypass the hot budget and preserve confirmation state', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ...row(i), content: 'x'.repeat(5 * 1024 * 1024),
    body: { id: `body-${i}`, owner: 'test', chars: 5 * 1024 * 1024 },
    pendingQuestion: { questionId: `confirm-${i}`, questionType: 'confirmation', question: 'Continue?' },
    taskExecution: { taskId: `task-${i}`, status: 'waiting' as const, progress: 50, steps: [], reasoning: 'why'.repeat(10000) },
  }))
  const hot = retainHotMessages(rows)
  assert.equal(hot.length, 120)
  assert.ok(JSON.stringify(hot).length * 2 <= 4 * 1024 * 1024)
  assert.equal(hot[0].pendingQuestion?.questionId, 'confirm-0')
  assert.equal(hot[0].body?.chars, 5 * 1024 * 1024)
})
