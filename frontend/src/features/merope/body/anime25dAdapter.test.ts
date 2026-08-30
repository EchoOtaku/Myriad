import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { setLiveFaceVisible } from '../faceVisible'
import { RigMotionCoordinator } from '../motion/coordinator'
import { MotionRuntime } from '../motion/runtime'
import { Anime25DBodyAdapter } from './anime25dAdapter'

test('Anime2.5D adapter exposes semantic capabilities and state, not drivers', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  runtime.setCapabilities(['blink', 'head-body'])
  const body = new Anime25DBodyAdapter(runtime)
  assert.ok(body.capabilities().semantic.includes('head-body'))
  const state = body.state()
  assert.equal(state.expression, 'steady')
  assert.equal(typeof state.speaking, 'boolean')
  assert.equal('mouthOpen' in state, false)
  release()
})

test('adapter source never mentions Live2D or VRM placeholders', () => {
  const source = readFileSync(new URL('./anime25dAdapter.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /Live2D|VRM/)
  assert.doesNotMatch(source, /mouthOpen|angleX/)
})

test('production chat and perception go through the body adapters', () => {
  const engine = readFileSync(
    new URL('../../../components/agent-panel/AgentEngine.tsx', import.meta.url),
    'utf8',
  )
  const panel = readFileSync(
    new URL('../../../components/GlobalControlPanel.tsx', import.meta.url),
    'utf8',
  )
  const arbitration = readFileSync(
    new URL('../faceSpeechArbitration.ts', import.meta.url),
    'utf8',
  )
  const captureCallers = [
    engine,
    panel,
    arbitration,
    readFileSync(new URL('./host.ts', import.meta.url), 'utf8'),
  ]
  for (const source of captureCallers) {
    assert.doesNotMatch(source, /capturePerceptionSnapshots/)
    assert.doesNotMatch(source, /runtime\.performance\.apply/)
  }
  assert.doesNotMatch(engine, /speakLine/)
  assert.doesNotMatch(panel, /speakLine/)
  assert.doesNotMatch(
    readFileSync(new URL('./host.ts', import.meta.url), 'utf8'),
    /speakLine/,
  )
  assert.match(arbitration, /speakUnmountedLine/)
  const adapter = readFileSync(new URL('./anime25dAdapter.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(adapter, /capturePerceptionSnapshots/)
  const perception = readFileSync(
    new URL('./perceptionAdapter.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(perception, / as PageContent/)
  assert.doesNotMatch(perception, /speakLine/)
})

test('hidden face does not pretend a body intent was played', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  const body = new Anime25DBodyAdapter(runtime)
  setLiveFaceVisible(false)
  body.intend({
    messageId: 'proactive-1',
    speechText: '想跟你说一声',
    performance: {
      phase: 'delivery',
      moodRevision: 1,
      plan: { cues: [] },
    },
  })
  assert.equal(runtime.frame().speech, null)
  assert.equal(runtime.frame().performance, null)
  setLiveFaceVisible(true)
  body.intend({
    performance: {
      phase: 'delivery',
      moodRevision: 1,
      plan: {
        cues: [
          {
            intent: 'listen',
            atMs: 0,
            intensity: 1,
            tempo: 1,
            fadeInMs: 80,
            fadeOutMs: 120,
            interrupt: 'if-lower',
          },
        ],
      },
    },
  })
  assert.equal(runtime.frame().performance?.directive?.plan.cues[0]?.intent, 'listen')
  release()
})
