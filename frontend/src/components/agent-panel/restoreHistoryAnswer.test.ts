import assert from 'node:assert/strict'
import test from 'node:test'
import { retainHotMessages } from './messageBudget'
import { restoreHistoryAnswer } from './restoreHistoryAnswer'
import { SessionLoadScope } from './sessionLoadScope'

const source = { sessionId: 's', page: 1, questionId: 'q' }
const row = { id: 1, role: 'assistant' as const, content: 'old'.repeat(10000), createdAt: '2026-09-01', taskId: 't', metadata: { task: { status: 'waiting_for_input', pendingQuestion: { questionId: 'q', question: 'Choose', questionType: 'choice' } } } }
const task = { taskId: 't', recipeId: '', startedAt: '', status: 'waiting_for_input', progress: 50, pendingQuestion: { questionId: 'q', question: 'Choose', questionType: 'choice' } }

test('evicted history control is revalidated and restored without exceeding 120 hot rows', async () => {
  const calls: unknown[] = []
  const restored = await restoreHistoryAnswer('loaded_1', source, new AbortController().signal, {
    getSessionMessages: async (...args) => { calls.push(args.slice(0, 3)); return [row] },
    getTask: async id => { assert.equal(id, 't'); return task },
  })
  assert.ok(restored)
  const hot = retainHotMessages(Array.from({ length: 120 }, (_, i) => ({ ...restored, id: `new_${i}` })))
  const next = retainHotMessages([...hot, restored])
  assert.equal(next.length, 120)
  assert.equal(next.at(-1)?.pendingQuestion?.questionId, 'q')
  assert.equal(next.at(-1)?.content, '')
  assert.deepEqual(calls, [['s', 1, 40]])
})

test('stale question, different task, missing history and completed tasks cannot be answered', async () => {
  for (const changed of [{ ...task, taskId: 'other' }, { ...task, status: 'completed' }, { ...task, pendingQuestion: { ...task.pendingQuestion, questionId: 'new' } }]) {
    assert.equal(await restoreHistoryAnswer('loaded_1', source, new AbortController().signal, { getSessionMessages: async () => [row], getTask: async () => changed }), null)
  }
  assert.equal(await restoreHistoryAnswer('loaded_2', source, new AbortController().signal, { getSessionMessages: async () => [row], getTask: async () => { throw new Error('must not probe') } }), null)
})

test('session A to B to A invalidates a delayed historical task lookup', async () => {
  const scope = new SessionLoadScope()
  const signal = scope.capture('work')
  const held = Promise.withResolvers<typeof task>()
  const entered = Promise.withResolvers<void>()
  const pending = restoreHistoryAnswer('loaded_1', source, signal, { getSessionMessages: async () => [row], getTask: () => { entered.resolve(); return held.promise } })
  await entered.promise
  scope.begin('work')
  scope.begin('work')
  held.resolve(task)
  assert.equal(await pending, null)
  scope.reset()
})
