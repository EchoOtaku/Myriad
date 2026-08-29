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

test('live occupancy is a boolean ref, not a nested current.current object', () => {
  const lifecycle = source('./useRigMotionLifecycle.ts')
  assert.match(lifecycle, /useRef\(false\)/)
  assert.doesNotMatch(lifecycle, /useRef\(\{\s*current:\s*false\s*\}\)/)
  assert.match(source('./speechLease.ts'), /claim\('speech', \['mouth'\]\)/)
  assert.doesNotMatch(
    source('../useRigSpeechLifecycle.ts'),
    /coordinator\.release\('speech'/,
  )
})

test('workbench preview stays off the production coordinator', () => {
  const workbench = source('../anime25drig/Anime25DWorkbench.tsx')
  const studio = source('../SiteMotionWorkbench.tsx')
  const preview = source('./useRigMotionLifecycle.ts')
  assert.match(workbench, /replaceDriver/)
  assert.doesNotMatch(workbench, /useRigMotionLifecycle/)
  assert.doesNotMatch(workbench, /getRigMotionCoordinator/)
  assert.match(studio, /useRigPreviewMotionLifecycle/)
  assert.doesNotMatch(studio, /useRigSingingLifecycle/)
  assert.match(preview, /new RigMotionCoordinator/)
  assert.match(preview, /useRigPreviewMotionLifecycle/)
})
