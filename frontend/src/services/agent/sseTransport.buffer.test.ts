import type * as Transport from './sseTransport'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { AuthSubjectScope } from '../../utils/authSubject'
import { ApiError, parseApiErrorBody } from '../api'
import * as turnIdentity from './turnIdentity'

const code = ts.transpileModule(readFileSync(new URL('./sseTransport.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const final = { success: true, message: 'done', responseType: 'task_completed', suggestions: [] }
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
function harness(chunks: string[]) {
  let reads = 0
  let cancellations = 0
  let fetches = 0
  let polls = 0
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads < chunks.length) controller.enqueue(encoder.encode(chunks[reads++]))
      else controller.close()
    },
    cancel() { cancellations++ },
  }, { highWaterMark: 0 })
  const fetcher = async () => {
    fetches++
    return fetches === 1 ? new Response(body) : new Response(frame({ type: 'task_completed', response: final }))
  }
  const dependencies: Record<string, unknown> = {
    '../../i18n/hostLocaleHeaders': { hostLocaleHeaders: () => ({}) },
    '../../i18n/localeCopy': { currentCopy: () => ({ errors: {} }) },
    '../../utils/aiConfiguration': { fetchWithAiConfiguration: fetcher },
    '../../utils/authSubject': { authSubject: new AuthSubjectScope() },
    '../../utils/csrf': { getCSRFToken: async () => 'token', clearCSRFToken: () => {} },
    '../../utils/userFacingError': { isUselessErrorText: () => false },
    '../api': { ApiError, parseApiErrorBody },
    './taskEnvelope': { messageFromStepOutput: () => 'done' },
    './turnIdentity': turnIdentity,
  }
  const exports = {} as typeof Transport
  runInNewContext(code, {
    exports, require: (id: string) => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id] },
    AbortController, AbortSignal, setTimeout, clearTimeout, TextDecoder, Error,
    console: { ...console, warn: () => {} },
  })
  const activeControllers = new Set<AbortController>()
  return {
    execute: (onProgress?: TransportParameters['onProgress']) => exports.executeSSERequest({
      url: '/stream', method: 'GET', abortPrevious: false, activeControllers, onProgress,
      pollTaskUntilComplete: async () => { polls++; return { taskId: 'task', status: 'completed', progress: 100 } as never },
    }),
    snapshot: () => ({ reads, cancellations, fetches, polls, locked: body.locked, active: activeControllers.size }),
  }
}
type TransportParameters = Parameters<typeof Transport.executeSSERequest>[0]

for (const identity of [{ type: 'run_started', runId: 'run' }, { type: 'task_created', taskId: 'task' }]) {
  test(`unterminated oversized SSE frame fails without recovery after ${identity.type}`, async () => {
    const h = harness([frame(identity), 'data: ', ...Array.from({ length: 257 }, () => 'x'.repeat(32768)), 'never read'])
    await assert.rejects(h.execute(), (error: unknown) => (error as { code?: string }).code === 'SSE_BUFFER_LIMIT')
    const state = h.snapshot()
    assert.equal(state.fetches, 1)
    assert.equal(state.polls, 0)
    assert.equal(state.cancellations, 1)
    assert.equal(state.locked, false)
    assert.equal(state.active, 0)
    assert.ok(state.reads < 260)
  })
}

test('oversized single transport chunk fails before publishing its event and releases reader', async () => {
  const h = harness([frame({ type: 'summary_token', token: 'x'.repeat(25 * 1024 * 1024) }), 'never read'])
  let published = 0
  await assert.rejects(h.execute(() => { published++ }), (error: unknown) => (error as { code?: string }).code === 'SSE_BUFFER_LIMIT')
  assert.equal(published, 0)
  assert.deepEqual(h.snapshot(), { reads: 1, cancellations: 1, fetches: 1, polls: 0, locked: false, active: 0 })
})

test('legal multi-megabyte final response remains exact and event processing backpressures reads', async () => {
  const held = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const text = '界'.repeat(2 * 1024 * 1024)
  const h = harness([frame({ type: 'summary_token', token: 'first' }), frame({ type: 'task_completed', response: { ...final, message: text } })])
  const pending = h.execute(async event => {
    if (event.type === 'summary_token') { entered.resolve(); await held.promise }
  })
  await entered.promise
  assert.equal(h.snapshot().reads, 1)
  held.resolve()
  assert.equal((await pending).message, text)
  assert.equal(h.snapshot().locked, false)
})
