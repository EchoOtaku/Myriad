import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { arbitrateFaceSpeech } from '../faceSpeechArbitration'
import { applySingingWrite } from './applySnapshot'
import { RigMotionCoordinator } from './coordinator'
import { resolveSingingApply } from './singingApply'

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
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

test('player still composites groove, random, performance, expression, then speech', () => {
  const player = source('../anime25drig/player.ts')
  const ambient = player.indexOf('applyAnime25DAmbientMotion(')
  const action = player.indexOf('applyAnime25DActionMotion(')
  const stylized = player.indexOf('applyAnime25DStylizedMotion(')
  const speech = player.indexOf('applyAnime25DSpeechMotion(')
  assert.ok(ambient > 0 && action > ambient)
  assert.ok(stylized > action)
  assert.ok(speech > stylized)
  const composition = source('../anime25drig/driverComposition.ts')
  const random = composition.indexOf('applyRandomActionFrame(')
  const groove = composition.indexOf('applySingingGroove(')
  assert.ok(random > 0 && groove > random)
})

test('production faces consume the snapshot; sources do not take a rig', () => {
  const lifecycle = source('./useRigMotionLifecycle.ts')
  const speechSource = source('./speechSource.ts')
  const performanceSource = source('./performanceSource.ts')
  const singing = source('../useRigSingingLifecycle.ts')
  assert.match(lifecycle, /applyMotionFrame/)
  assert.match(lifecycle, /getProductionMotionRuntime/)
  assert.doesNotMatch(speechSource, /rigRef/)
  assert.doesNotMatch(performanceSource, /rigRef/)
  assert.match(speechSource, /claim\('coSpeech'/)
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

test('autonomy is a reserved source and never writes a rig', () => {
  const autonomyWrites = source('./speechSource.ts') + source('./applyFrame.ts')
  assert.doesNotMatch(autonomyWrites, /claim\('autonomy'/)
  assert.match(source('./channels.ts'), /autonomy is reserved/)
})
