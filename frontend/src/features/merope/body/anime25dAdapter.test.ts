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
  assert.match(engine, /getLocalPerception/)
  assert.match(engine, /setLiveBody\(getProductionBody\(\)\)/)
  assert.doesNotMatch(engine, /capturePerceptionSnapshots/)
  assert.doesNotMatch(engine, /runtime\.performance\.apply/)
  const adapter = readFileSync(new URL('./anime25dAdapter.ts', import.meta.url), 'utf8')
  assert.match(adapter, /this\.runtime\.performance\.apply/)
})

test('hidden face does not pretend a body intent was played', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const body = new Anime25DBodyAdapter(runtime)
  setLiveFaceVisible(false)
  body.intend({
    messageId: 'proactive-1',
    speechText: '想跟你说一声',
  })
  assert.equal(runtime.frame().speech, null)
  setLiveFaceVisible(true)
})
