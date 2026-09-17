import type { ChatMessage } from './engineTypes'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { authSubject } from '../../utils/authSubject'
import { retainHotMessages } from './messageBudget'
import { restoreHistoryAnswer } from './restoreHistoryAnswer'
import { SessionLoadScope } from './sessionLoadScope'

const source = ts.createSourceFile('AgentEngine.tsx', readFileSync(new URL('./AgentEngine.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback = ''
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'answerQuestion') callback = (node.initializer as ts.CallExpression).arguments[0].getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(callback)
const script = ts.transpileModule(`globalThis.answerQuestion = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const task = { taskId: 't', recipeId: '', startedAt: '', status: 'waiting_for_input', progress: 50, pendingQuestion: { questionId: 'q', questionType: 'choice', question: 'Choose' } }
function harness(probe = async () => task) {
  const scope = new SessionLoadScope()
  let rows: ChatMessage[] = Array.from({ length: 120 }, (_, i) => ({ id: `hot_${i}`, sessionId: 's', role: 'assistant', content: '', createdAt: new Date(), taskExecution: { taskId: `t${i}`, status: 'waiting', steps: [], progress: 50 } }))
  const posts: unknown[] = []
  const noop = () => {}
  const ctx: Record<string, any> = {
    historyAnswerBusy: { current: false }, sessionLoads: scope, restoreHistoryAnswer,
    sessionIdsByModeRef: { current: { work: 's' } },
    findMessage: (id: string) => rows.find(row => row.id === id),
    setMessages: (update: (rows: ChatMessage[]) => ChatMessage[]) => { rows = retainHotMessages(update(rows)) },
    updateMessage: (id: string, update: Partial<ChatMessage>) => { rows = rows.map(row => row.id === id ? { ...row, ...update } : row) },
    updateMessageExecution: noop,
    agentService: { getSessionMessages: async () => [{ id: 1, role: 'assistant', content: '', createdAt: '2026-09-01', taskId: 't', metadata: { task: { pendingQuestion: task.pendingQuestion } } }], getTask: probe,
      answerQuestionWithProgress: async (...args: unknown[]) => { posts.push(args.slice(0, 3)); return {} } },
    loadingMessageIdByModeRef: { current: { work: null } }, loadingByModeRef: { current: { work: false, chat: false } },
    setAgentLaneLoading: noop, setIsLoading: noop, setAgentStatusThinking: noop,
    beginTurnTrace: noop, markTurnTraceOnce: noop, createProgressHandler: noop,
    handleAgentResponseRef: { current: noop }, stopTurnSpeech: noop, finishTurnTrace: noop,
    isUserInterruptError: () => false, isStreamSupersededError: () => false,
    userFacingError: String, t: { errors: {}, agentPanel: {} }, format: String,
  }
  runInNewContext(script, ctx)
  return { ctx, scope, posts, rows: () => rows }
}
const history = { sessionId: 's', page: 1, questionId: 'q' }

test('real answer callback restores one evicted control and submits its validated task/question', async () => {
  const h = harness()
  await h.ctx.answerQuestion('loaded_1', 'yes', history)
  assert.deepEqual(h.posts, [['t', 'q', 'yes']])
  assert.equal(h.rows().length, 120)
  assert.equal(h.rows().at(-1)?.id, 'loaded_1')
  await h.ctx.answerQuestion('loaded_1', 'yes', history)
  assert.equal(h.posts.length, 1)
  h.scope.reset()
})

test('wrong session, changed question, and identity loss cannot submit historical answers', async () => {
  const wrong = harness()
  await wrong.ctx.answerQuestion('loaded_1', 'yes', { ...history, sessionId: 'other' })
  assert.equal(wrong.posts.length, 0)
  const changed = harness(async () => ({ ...task, pendingQuestion: { ...task.pendingQuestion, questionId: 'new' } }))
  await changed.ctx.answerQuestion('loaded_1', 'yes', history)
  assert.equal(changed.posts.length, 0)
  const held = Promise.withResolvers<typeof task>()
  const entered = Promise.withResolvers<void>()
  const stale = harness(() => { entered.resolve(); return held.promise })
  const pending = stale.ctx.answerQuestion('loaded_1', 'yes', history)
  await entered.promise
  authSubject.change('other-user', true)
  held.resolve(task)
  await pending
  assert.equal(stale.posts.length, 0)
  assert.equal(stale.rows().some(row => row.id === 'loaded_1'), false)
  for (const h of [wrong, changed, stale]) h.scope.reset()
  authSubject.change('guest', true)
})
