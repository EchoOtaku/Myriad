import type { ChatMessage } from './engineTypes'
import assert from 'node:assert/strict'
import test from 'node:test'
import { boundMessage, retainHotMessages, HOT_MESSAGE_LIMIT } from './messageBudget'

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
