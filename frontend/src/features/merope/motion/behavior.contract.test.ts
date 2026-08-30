import type { PerformanceDirective } from '../../../services/agent/types'
import type { MotionFrame } from './intents'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { arbitrateFaceSpeech } from '../faceSpeechArbitration'
import { applyMotionFrame, createMotionApplyState } from './applyFrame'
import { applySingingWrite } from './applySnapshot'
import { RigMotionCoordinator } from './coordinator'
import { resolveSingingApply } from './singingApply'

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

function recordingRig() {
  const calls: string[] = []
  return {
    calls,
    rig: {
      setMotionPolicy: (policy: { mouth: string; expression: string }) =>
        calls.push(`policy:${policy.mouth}:${policy.expression}`),
      setSpeechActive: (value: boolean) => calls.push(`speechActive:${value}`),
      setAutoSpeech: (value: boolean) => calls.push(`auto:${value}`),
      setSpeechEnergy: () => undefined,
      setSpeechArticulation: () => undefined,
      enqueueSpeechText: (text: string) => calls.push(`text:${text}`),
      playMotionPlan: () => {
        calls.push('play')
        return true
      },
      stopMotionPlan: () => calls.push('stop'),
      setSinging: (value: boolean) => calls.push(`singing:${value}`),
      setSingingSpectrum: () => undefined,
    },
  }
}

function frame(
  coordinator: RigMotionCoordinator,
  nowMs: number,
  extra: Partial<MotionFrame> = {},
): MotionFrame {
  return {
    snapshot: coordinator.snapshot(nowMs),
    speech: null,
    performance: null,
    music: null,
    mood: null,
    autonomy: null,
    ...extra,
  }
}

const listenPlan: PerformanceDirective = {
  phase: 'mood',
  moodRevision: 0,
  plan: {
    baseline: {
      expression: 'steady',
      posture: 'neutral',
      motionEnergy: 0.55,
      attention: 0.45,
    },
    cues: [
      {
        intent: 'listen',
        atMs: 0,
        intensity: 0.55,
        tempo: 1,
        fadeInMs: 80,
        fadeOutMs: 120,
        interrupt: 'if-lower',
      },
    ],
  },
}

test('Chat speech occupies only the mouth; music keeps head and body', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.claim('speech', ['mouth'], { nowMs: 1 })
  const snapshot = coordinator.snapshot(1)
  assert.equal(snapshot.owners.mouth, 'speech')
  assert.equal(snapshot.owners.headBody, 'music')

  const apply = resolveSingingApply({
    gap: 'active',
    holdExpired: false,
    audioPaused: false,
    mouthOwner: snapshot.owners.mouth,
    headBodyOwner: snapshot.owners.headBody,
  })
  assert.equal(apply.writeMouth, false)
  assert.equal(apply.writeGroove, true)
  assert.equal(apply.release, false)

  const writes: string[] = []
  applySingingWrite(
    {
      setSinging: (value) => writes.push(`singing:${value}`),
      setSingingSpectrum: (value) => writes.push(`spectrum:${value !== null}`),
      setSpeechArticulation: () => writes.push('articulation'),
      setSpeechActive: () => writes.push('speechActive'),
    },
    apply,
    {
      spectrum: { bass: 0.4, beat: 0.5, vocal: 0.6 },
      articulation: { energy: 0.6, viseme: 'open', amount: 0.8 },
    },
  )
  assert.deepEqual(writes, ['singing:true', 'spectrum:true'])
})

test('background Work cannot take the visible Chat face', () => {
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'chat',
      incomingMode: 'work',
      chatUtteranceActive: false,
    }),
    'record-without-speech',
  )
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'work',
      incomingMode: 'work',
      chatUtteranceActive: true,
    }),
    'record-without-speech',
  )
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'chat',
      incomingMode: 'chat',
      chatUtteranceActive: false,
    }),
    'speak',
  )
})

test('applyFrame writes speech text only while speech owns the mouth', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.claim('speech', ['mouth'], { nowMs: 1 })
  const host = recordingRig()
  applyMotionFrame(
    host.rig,
    frame(coordinator, 1, {
      speech: {
        active: true,
        autoSpeech: true,
        energy: null,
        articulation: null,
        queuedText: [{ seq: 1, text: '你好' }],
      },
    }),
    createMotionApplyState(),
  )
  assert.ok(host.calls.includes('policy:speech:idle'))
  assert.ok(host.calls.includes('text:你好'))
})

test('applyFrame plays an autonomy plan only while autonomy owns the face', () => {
  const coordinator = new RigMotionCoordinator()
  const handle = coordinator.claim('autonomy', ['expression', 'gaze'], {
    nowMs: 1,
  })
  const host = recordingRig()
  const state = createMotionApplyState()
  const autonomy = { directive: listenPlan, startedAtMs: 20 }
  applyMotionFrame(host.rig, frame(coordinator, 1, { autonomy }), state)
  coordinator.release(handle)
  applyMotionFrame(host.rig, frame(coordinator, 2, { autonomy }), state)
  assert.ok(host.calls.includes('play'))
  assert.ok(host.calls.includes('stop'))
})

test('production faces consume the snapshot; sources do not take a rig', () => {
  const speechSource = source('./speechSource.ts')
  const performanceSource = source('./performanceSource.ts')
  const singing = source('../useRigSingingLifecycle.ts')
  const lifecycle = source('./useRigMotionLifecycle.ts')
  assert.match(lifecycle, /getProductionMotionRuntime/)
  assert.doesNotMatch(speechSource, /rigRef/)
  assert.doesNotMatch(performanceSource, /rigRef/)
  assert.doesNotMatch(singing, /applySingingWrite/)
  assert.doesNotMatch(singing, /rigRef/)
})

test('workbench preview stays off the production coordinator', () => {
  const workbench = source('../anime25drig/Anime25DWorkbench.tsx')
  const studio = source('../SiteMotionWorkbench.tsx')
  const preview = source('./useRigMotionLifecycle.ts')
  assert.match(workbench, /PreviewMotionScope/)
  assert.match(workbench, /replaceDriver/)
  assert.doesNotMatch(workbench, /useRigMotionLifecycle/)
  assert.doesNotMatch(workbench, /getRigMotionCoordinator/)
  assert.doesNotMatch(workbench, /getProductionMotionRuntime/)
  assert.match(studio, /useRigPreviewMotionLifecycle/)
  assert.doesNotMatch(studio, /useRigSingingLifecycle/)
  assert.match(preview, /createPreviewMotionRuntime/)
})

test('agent turns send a semantic rig summary instead of per-frame drivers', () => {
  const engine = source('../../../components/agent-panel/AgentEngine.tsx')
  assert.match(engine, /captureProductionRigStateSummary/)
  assert.match(engine, /rigState/)
  const capture = source('./rigStateSummary.ts')
  assert.doesNotMatch(capture, /mouthOpen/)
  assert.doesNotMatch(capture, /angleX/)
  const player = source('../anime25drig/player.ts')
  assert.doesNotMatch(player, /captureRigStateSummary/)
})

test('autonomy claims through the coordinator and never writes a rig', () => {
  const autonomy = source('./autonomySource.ts')
  const apply = source('./applyFrame.ts')
  assert.match(autonomy, /claim\('autonomy'/)
  assert.match(autonomy, /\['expression', 'gaze'\]/)
  assert.doesNotMatch(autonomy, /headBody/)
  assert.doesNotMatch(autonomy, /'mouth'/)
  assert.doesNotMatch(autonomy, /rigRef|playMotionPlan/)
  assert.doesNotMatch(apply, /claim\('autonomy'/)
  assert.match(apply, /frame\.autonomy/)
  assert.match(apply, /kind: 'autonomy'/)
  assert.match(apply, /playMotionPlan\(next\.directive/)
  assert.doesNotMatch(source('./speechSource.ts'), /claim\('autonomy'/)
  assert.match(source('./channels.ts'), /never writes a rig/)
  assert.match(
    source('./runtimeHost.ts'),
    /new MotionRuntime\(\s*getRigMotionCoordinator\(\),\s*getMusicMotionSource\(\),\s*true/,
  )
  assert.match(
    source('./runtime.ts'),
    /createPreviewMotionRuntime[\s\S]*new MotionRuntime\(new RigMotionCoordinator\(\)\)/,
  )
})
