import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  beginTurnTrace,
  markTurnTraceOnce,
  noteTurnTraceDrop,
  noteTurnTraceQueue,
  resetTurnTraceForTest,
  snapshotTurnTrace,
  stampTurnTrace,
  TURN_TRACE_SPANS,
} from './turnTrace'

test('pending input stamps attach to the next turn without using the run hub', () => {
  resetTurnTraceForTest()
  stampTurnTrace('input_started')
  stampTurnTrace('input_final')
  beginTurnTrace('msg-1')
  markTurnTraceOnce('request_sent')
  markTurnTraceOnce('llm_first_token')
  markTurnTraceOnce('turn_completed')
  const snap = snapshotTurnTrace()
  assert.equal(snap.turnId, 'msg-1')
  assert.deepEqual(
    snap.marks.map((mark) => mark.span),
    [
      'input_started',
      'input_final',
      'request_sent',
      'llm_first_token',
      'turn_completed',
    ],
  )
  assert.ok(snap.delays.llmFirstTokenMs >= 0)
  assert.equal(TURN_TRACE_SPANS.length, 12)
})

test('the ring drops the oldest marks and counts stale generations', () => {
  resetTurnTraceForTest()
  beginTurnTrace('msg-2')
  for (let i = 0; i < 120; i++) markTurnTraceOnce(`extra-${i}`)
  noteTurnTraceDrop('stale_generation')
  noteTurnTraceQueue(3)
  noteTurnTraceQueue(1)
  const snap = snapshotTurnTrace()
  assert.equal(snap.marks.length, 96)
  assert.equal(snap.marks[0]?.span, 'extra-25')
  assert.equal(snap.marks.at(-1)?.span, 'drop')
  assert.equal(snap.counters.staleGenerationDrops, 1)
  assert.equal(snap.counters.ttsQueuePeak, 3)
  assert.equal(snap.counters.ttsQueueLength, 1)
})

test('trace sources stay off the run hub and never persist visemes', () => {
  const trace = readFileSync(new URL('./turnTrace.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(trace, /run_hub|AgentProgressEvent/)
  assert.doesNotMatch(trace, /phase: 'articulation'/)
  const files = [
    './turnTraceSample.ts',
    './speech/speechPipelineHost.ts',
    './speech/ttsPipeline.ts',
    '../../components/agent-panel/AgentEngine.tsx',
  ]
  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /run_hub/)
    assert.doesNotMatch(source, /markTurnTrace\([^)]*viseme/)
  }
  const engine = readFileSync(
    new URL('../../components/agent-panel/AgentEngine.tsx', import.meta.url),
    'utf8',
  )
  assert.match(engine, /beginTurnTrace\(/)
  assert.match(engine, /livePresenceFacts\(/)
})
