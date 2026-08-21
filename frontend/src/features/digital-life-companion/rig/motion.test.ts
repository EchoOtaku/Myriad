import type { GazeTarget } from './motion'
import type { CompanionRigManifest, RigTransform } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blinkBreathSequenceDelaySeconds,
  blinkBreathValleyDelaySeconds,
  boundedGazeHeadYawFollow,
  boundedStateFollow,
  chestBreathAmplitudeScale,
  createDefaultMotionProfile,
  gazeSourceHandoffRateScale,
  idleAccentCooldownMs,
  idleAccentDelayMs,
  idleGazeGlanceDelayMs,
  idleGazeGlanceStyle,
  idleLockAllowsShoulderMacro,
  MotionRuntime,
  motionStyleFromState,
  nextSeededUnit,
  resolveSecondaryCollision,
  restPhaseRateScale,
  restWakeAmplitudeScale,
  restWeightFromEnergy,
  secondarySpringDynamics,
  shoulderWeightShiftPhaseScale,
  SPEECH_BREATH_RECOVERY_MS,
  SPEECH_MOUTH_CLOSE_MS,
  speechBreathAmplitudeScale,
  speechBreathReleaseScale,
  speechMouthReleaseWeight,
  translatedDoubleBlinkSecondStart,
  WAKE_FIDGET_SETTLE_MS,
  writeGazeTargetInto,
} from './motion'
import {
  canSupersedePendingWakeActions,
  RIG_ACTION_PRIORITY,
} from './transitions'

const state = {
  energy: 70,
  mood: 65,
  boredom: 35,
  curiosity: 72,
  social: 60,
  affection: 55,
}

const manifest = {
  defaultClip: 'idle',
  bones: [
    { id: 'root', parent: null },
    { id: 'body', parent: 'root' },
    { id: 'head', parent: 'body' },
    { id: 'left-eye', parent: 'head' },
    { id: 'right-eye', parent: 'head' },
    { id: 'mouth', parent: 'head' },
    { id: 'front-hair', parent: 'head' },
    { id: 'ribbon', parent: 'head' },
  ],
} as CompanionRigManifest

function pose(): RigTransform[] {
  return manifest.bones.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
}

test('maps continuous character state into independent motion style axes', () => {
  const calm = motionStyleFromState({ ...state, energy: 20, mood: 35 })
  const lively = motionStyleFromState({ ...state, energy: 90, mood: 85 })
  assert.ok(lively.tempo > calm.tempo)
  assert.ok(lively.force > calm.force)
  assert.ok(lively.expansion > calm.expansion)
  assert.ok(calm.fluidity > 0)
})

test('seeded random sequence is deterministic and bounded', () => {
  const first = nextSeededUnit(123)
  const repeated = nextSeededUnit(123)
  assert.deepEqual(first, repeated)
  assert.ok(first.value >= 0 && first.value < 1)
})

test('idle accents become more frequent with boredom without becoming frantic', () => {
  const calm = idleAccentDelayMs({ energy: 60, mood: 55, boredom: 0 }, 0.5)
  const bored = idleAccentDelayMs({ energy: 60, mood: 55, boredom: 100 }, 0.5)
  assert.ok(bored < calm)
  assert.ok(bored >= 10_000)
  assert.ok(calm <= 42_000)
  const fidget = idleAccentDelayMs(
    { energy: 60, mood: 55, boredom: 56 },
    0.5,
    'fidget',
  )
  assert.ok(
    fidget < idleAccentDelayMs({ energy: 60, mood: 55, boredom: 56 }, 0.5),
  )
  assert.ok(fidget >= 8_000)

  const veryBoredDelays = [0, 0.25, 0.5, 0.75, 1].map((randomUnit) =>
    idleAccentDelayMs(
      { energy: 72, mood: 55, boredom: 100 },
      randomUnit,
      'fidget',
    ),
  )
  const cooldown = idleAccentCooldownMs({ boredom: 100 }, 'fidget')
  assert.equal(cooldown, 6_000)
  assert.ok(veryBoredDelays.every((delay) => delay >= cooldown))
  assert.ok(
    Math.max(...veryBoredDelays) < fidget,
    'very high boredom is visibly denser without bypassing its cooldown',
  )
})

test('idle side glances stay subtle and recur every three to eight seconds', () => {
  assert.equal(idleGazeGlanceDelayMs(0), 3_000)
  assert.equal(idleGazeGlanceDelayMs(1), 8_000)

  const runtime = new MotionRuntime(manifest)
  const starts: number[] = []
  let wasActive = false
  let maximumX = 0
  let maximumY = 0
  for (let now = 0; now <= 32_000; now += 20) {
    const signals = runtime.signals(now, 'idle')
    const active = Math.abs(signals.idleGlanceX) > 0.0001
    if (active && !wasActive) starts.push(now)
    maximumX = Math.max(maximumX, Math.abs(signals.idleGlanceX))
    maximumY = Math.max(maximumY, Math.abs(signals.idleGlanceY))
    wasActive = active
  }

  assert.ok(starts.length >= 4)
  for (let index = 1; index < starts.length; index += 1) {
    const interval = starts[index] - starts[index - 1]
    assert.ok(interval >= 2_980)
    assert.ok(interval <= 8_020)
  }
  assert.ok(maximumX >= 0.18)
  assert.ok(maximumX <= 0.32)
  assert.ok(maximumY <= 0.12)
})

test('long uninterrupted idle gradually spaces side glances farther apart', () => {
  assert.equal(idleGazeGlanceDelayMs(0, 90), 3_000)
  assert.equal(idleGazeGlanceDelayMs(1, 90), 8_000)
  assert.ok(idleGazeGlanceDelayMs(0, 180) > 3_000)
  assert.ok(idleGazeGlanceDelayMs(1, 180) > 8_000)
  assert.equal(idleGazeGlanceDelayMs(0, 330), 7_500)
  assert.equal(idleGazeGlanceDelayMs(1, 330), 20_000)

  const runtime = new MotionRuntime(manifest)
  const starts: number[] = []
  let wasActive = false
  for (let now = 0; now <= 360_000; now += 20) {
    const active = Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.0001
    if (active && !wasActive) starts.push(now)
    wasActive = active
  }
  const intervals = starts.slice(1).map((start, index) => ({
    start,
    interval: start - starts[index],
  }))
  const early = intervals
    .filter(({ start }) => start >= 20_000 && start <= 80_000)
    .map(({ interval }) => interval)
  const late = intervals
    .filter(({ start }) => start >= 280_000 && start <= 350_000)
    .map(({ interval }) => interval)
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length

  assert.ok(early.length >= 8)
  assert.ok(late.length >= 3)
  assert.ok(
    average(late) > average(early) * 1.8,
    'late idle looks restful instead of repeating the opening cadence',
  )
})

test('consecutive idle side glances always alternate direction', () => {
  const runtime = new MotionRuntime(manifest)
  const directions: number[] = []
  let wasActive = false
  for (let now = 0; now <= 48_000; now += 20) {
    const glance = runtime.signals(now, 'idle').idleGlanceX
    const active = Math.abs(glance) > 0.0001
    if (active && !wasActive) directions.push(Math.sign(glance))
    wasActive = active
  }

  assert.ok(directions.length >= 6)
  for (let index = 1; index < directions.length; index += 1) {
    assert.equal(
      directions[index],
      -directions[index - 1],
      'each glance uses the side opposite the previous glance',
    )
  }
})

test('idle glances quiet whole-handwear follow-through until the eyes return', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const coordinated = new MotionRuntime(layeredManifest)
  const uncoordinated = new MotionRuntime(layeredManifest)
  for (const runtime of [coordinated, uncoordinated]) {
    runtime.setCharacterState({ ...state, energy: 82, boredom: 90 })
  }
  uncoordinated.setGazeTarget(
    { x: 0, y: 0, attention: 0.4, source: 'camera' },
    0,
  )

  let glanceStartedAt = -1
  let glanceEndedAt = -1
  let wasActive = false
  const duringRatios: number[] = []
  const bodyRatios: number[] = []
  const afterRatios: number[] = []
  for (let now = 0; now <= 12_000; now += 16) {
    const coordinatedPose = layeredManifest.bones.map(() => pose()[0])
    const referencePose = layeredManifest.bones.map(() => pose()[0])
    coordinated.applyInto(coordinatedPose, now, 'idle')
    uncoordinated.applyInto(referencePose, now, 'idle')
    const active =
      Math.abs(coordinated.debugSignals().idleGlance.x) > 0.0001 ||
      Math.abs(coordinated.debugSignals().idleGlance.y) > 0.0001
    if (active && !wasActive && glanceStartedAt < 0) glanceStartedAt = now
    if (!active && wasActive && glanceEndedAt < 0) glanceEndedAt = now

    const coordinatedMagnitude = Math.abs(coordinatedPose[8].rotation)
    const referenceMagnitude = Math.abs(referencePose[8].rotation)
    if (referenceMagnitude > 0.0001) {
      if (active && glanceEndedAt < 0 && now >= glanceStartedAt + 160) {
        duringRatios.push(coordinatedMagnitude / referenceMagnitude)
        if (Math.abs(referencePose[1].rotation) > 0.0001) {
          bodyRatios.push(
            Math.abs(coordinatedPose[1].rotation) /
              Math.abs(referencePose[1].rotation),
          )
        }
      } else if (
        glanceEndedAt >= 0 &&
        now >= glanceEndedAt + 800 &&
        now <= glanceEndedAt + 1_600
      ) {
        afterRatios.push(coordinatedMagnitude / referenceMagnitude)
      }
    }
    wasActive = active
  }

  assert.ok(glanceStartedAt >= 3_000)
  assert.ok(glanceEndedAt > glanceStartedAt)
  assert.ok(duringRatios.length > 8)
  assert.ok(
    Math.max(...duringRatios) < 0.24,
    'the glance owns attention while handwear follow-through stays subdued',
  )
  assert.ok(bodyRatios.length > 8)
  assert.ok(
    Math.max(...bodyRatios) < 0.24,
    'parent torso weight-shift cannot carry quiet handwear through the glance',
  )
  assert.ok(afterRatios.length > 8)
  assert.ok(
    afterRatios.at(-1)! > afterRatios[0],
    'handwear follow-through returns only after the eyes have come back',
  )
  assert.ok(afterRatios.at(-1)! > 0.94)
})

test('rest mode disables scheduled side glances outright', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 32_000; now += 50) {
    const signals = runtime.signals(now, 'idle')
    assert.equal(signals.idleGlanceX, 0)
    assert.equal(signals.idleGlanceY, 0)
  }
})

test('suppressed glance hot path reuses its signal and debug buffers', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setIdleBehaviorMode('rest')
  const signals = runtime.signals(0, 'idle')
  const debug = runtime.debugSignals()
  const debugGlance = debug.idleGlance

  for (let now = 16; now <= 8_000; now += 16) {
    assert.strictEqual(runtime.signals(now, 'idle'), signals)
    assert.strictEqual(runtime.debugSignals(), debug)
    assert.strictEqual(runtime.debugSignals().idleGlance, debugGlance)
  }
})

test('gaze target updates reuse caller-owned source buffers', () => {
  const target: GazeTarget = { x: 0, y: 0, attention: 0 }
  assert.strictEqual(writeGazeTargetInto(target, 2, -2, 1.4, 'pointer'), target)
  assert.deepEqual(target, {
    x: 1,
    y: -1,
    attention: 1,
    source: 'pointer',
  })
  assert.strictEqual(
    writeGazeTargetInto(target, -0.4, 0.3, 0.7, 'pointer'),
    target,
  )
  assert.deepEqual(target, {
    x: -0.4,
    y: 0.3,
    attention: 0.7,
    source: 'pointer',
  })
})

test('gaze source handoff applies one bounded rate envelope to head yaw', () => {
  assert.equal(gazeSourceHandoffRateScale(-1), 0.38)
  assert.equal(gazeSourceHandoffRateScale(0), 0.38)
  assert.equal(gazeSourceHandoffRateScale(0.24), 1)
  assert.equal(gazeSourceHandoffRateScale(1), 1)

  const delta = 0.016
  const handoffScale = gazeSourceHandoffRateScale(0)
  const next = boundedGazeHeadYawFollow(-1, 1, delta, 5.4, handoffScale)
  assert.ok(next > -1)
  assert.ok(
    next + 1 <= delta * 3.2 * handoffScale + 1e-12,
    'an opposite-side handoff cannot exceed the handoff-scaled yaw budget',
  )
})

test('ambient fidgets cancel a live glance and restart its quiet interval', () => {
  const runtime = new MotionRuntime(manifest)
  let fidgetAt = -1
  for (let now = 0; now <= 10_000; now += 10) {
    runtime.signals(now, 'idle')
    if (runtime.idleGlanceActive(now)) {
      fidgetAt = now
      break
    }
  }
  assert.ok(fidgetAt >= 3_000)

  runtime.setAmbientFidgetActive(true)
  assert.equal(runtime.idleGlanceActive(fidgetAt), false)
  for (let now = fidgetAt + 10; now <= fidgetAt + 2_000; now += 10) {
    const signals = runtime.signals(now, 'idle')
    assert.equal(signals.idleGlanceX, 0)
    assert.equal(signals.idleGlanceY, 0)
  }

  runtime.setAmbientFidgetActive(false)
  for (let now = fidgetAt + 2_010; now < fidgetAt + 5_010; now += 10) {
    assert.equal(runtime.signals(now, 'idle').idleGlanceX, 0)
  }
})

test('entering rest interrupts a live glance and wake starts a fresh interval', () => {
  const runtime = new MotionRuntime(manifest)
  let restAt = -1
  for (let now = 0; now <= 8_000; now += 10) {
    if (Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.002) {
      restAt = now
      break
    }
  }
  assert.ok(restAt >= 3_000)

  runtime.setIdleBehaviorMode('rest')
  assert.deepEqual(runtime.debugSignals().idleGlance, { x: 0, y: 0 })
  for (let now = restAt + 10; now <= restAt + 1_000; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    assert.equal(runtime.signals(now, 'idle').idleGlanceX, 0)
    assert.ok(
      output[3].scale.y > 0.95,
      'the abandoned glance blink is cancelled',
    )
  }

  runtime.setIdleBehaviorMode('idle')
  for (let now = restAt + 1_010; now < restAt + 4_010; now += 10) {
    assert.equal(runtime.signals(now, 'idle').idleGlanceX, 0)
  }
})

test('rest stillness starts ramping immediately while a fidget is interrupted', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 12, boredom: 90 })
  runtime.setIdleBehaviorMode('fidget')
  runtime.setAmbientFidgetActive(true)
  runtime.applyInto(pose(), 0, 'idle')
  runtime.applyInto(pose(), 1_000, 'idle')

  runtime.setIdleBehaviorMode('rest')
  assert.equal(runtime.idleGlanceActive(1_000), false)
  const stillness: number[] = []
  for (let now = 1_016; now <= 1_400; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
    stillness.push(runtime.debugSignals().restStillness)
  }

  assert.ok(stillness[0] > 0, 'rest starts on the first post-transition frame')
  assert.ok(
    stillness.every(
      (value, index) => index === 0 || value > stillness[index - 1],
    ),
    'restStillness rises continuously without waiting for the fidget duration',
  )
})

test('collapsed 10 FPS gaze stays off and expansion waits a full first interval', () => {
  const runtime = new MotionRuntime(manifest)
  let collapsedAt = -1
  for (let now = 0; now <= 8_000; now += 20) {
    if (Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.002) {
      collapsedAt = now
      break
    }
  }
  assert.ok(collapsedAt >= 3_000, 'collapse interrupts a live side glance')

  runtime.setExpanded(false)
  const expandedAt = collapsedAt + 20_000
  for (let now = collapsedAt + 100; now <= expandedAt; now += 100) {
    const signals = runtime.signals(now, 'idle')
    assert.equal(signals.idleGlanceX, 0)
    assert.equal(signals.idleGlanceY, 0)
  }

  runtime.setExpanded(true)
  for (let now = expandedAt + 100; now < expandedAt + 3_100; now += 100) {
    assert.equal(runtime.signals(now, 'idle').idleGlanceX, 0)
  }
  let firstExpandedGlance = -1
  for (let now = expandedAt + 3_100; now <= expandedAt + 8_200; now += 20) {
    if (Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.0001) {
      firstExpandedGlance = now
      break
    }
  }
  assert.ok(firstExpandedGlance >= expandedAt + 3_100)
  assert.ok(firstExpandedGlance <= expandedAt + 8_200)
})

test('explicit gaze interrupts an idle side glance and restarts its quiet interval', () => {
  const runtime = new MotionRuntime(manifest)
  let interruptedAt = -1
  for (let now = 0; now <= 8_000; now += 20) {
    if (Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.04) {
      interruptedAt = now
      break
    }
  }
  assert.ok(interruptedAt >= 3_000, 'the seeded glance becomes active')

  runtime.setGazeTarget(
    { x: -1, y: -0.2, attention: 1, source: 'pointer' },
    interruptedAt,
  )
  const beforeInterrupt = pose()
  runtime.applyInto(beforeInterrupt, interruptedAt, 'idle')
  for (let now = interruptedAt + 20; now <= interruptedAt + 400; now += 20) {
    const signals = runtime.signals(now, 'idle')
    assert.equal(signals.idleGlanceX, 0)
    assert.equal(signals.idleGlanceY, 0)
  }
  const afterInterrupt = pose()
  runtime.applyInto(afterInterrupt, interruptedAt + 420, 'idle')
  assert.ok(
    Math.abs(
      afterInterrupt[3].translation.x - beforeInterrupt[3].translation.x,
    ) < 0.0065,
    'the shared gaze follower prevents a one-frame eye snap',
  )

  runtime.setGazeTarget(null, interruptedAt + 420, 'pointer')
  for (let now = interruptedAt + 440; now < interruptedAt + 3_420; now += 20) {
    assert.equal(runtime.signals(now, 'idle').idleGlanceX, 0)
  }
  let resumed = false
  for (
    let now = interruptedAt + 3_420;
    now <= interruptedAt + 8_440;
    now += 20
  ) {
    if (Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.0001) {
      resumed = true
      break
    }
  }
  assert.equal(resumed, true, 'ambient gaze returns only after a fresh delay')
})

test('pointer hit during a side glance recenters before acquiring the pointer', () => {
  const runtime = new MotionRuntime(manifest)
  let glanceAt = -1
  let glanceDirection = 0
  let sidePose = pose()
  for (let now = 0; now <= 8_000; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    const glance = runtime.debugSignals().idleGlance.x
    if (
      Math.abs(glance) > 0.12 &&
      output[3].translation.x * Math.sign(glance) > 0.00015
    ) {
      glanceAt = now
      glanceDirection = Math.sign(glance)
      sidePose = output
      break
    }
  }
  assert.ok(glanceAt >= 3_000)
  assert.ok(sidePose[3].translation.x * glanceDirection > 0.0001)

  const pointerDirection = -glanceDirection
  runtime.setGazeTarget(
    { x: pointerDirection, y: -0.2, attention: 1, source: 'pointer' },
    glanceAt,
  )
  const samples: Array<{
    age: number
    source: ReturnType<MotionRuntime['debugSignals']>['gazeSource']
    eyeX: number
    eyeY: number
    headRotation: number
    hairRotation: number
  }> = []
  for (let age = 20; age <= 800; age += 20) {
    if (age === 200) {
      runtime.setGazeTarget(
        {
          x: pointerDirection * 0.8,
          y: 0.35,
          attention: 0.9,
          source: 'pointer',
        },
        glanceAt + age,
      )
    }
    const output = pose()
    runtime.applyInto(output, glanceAt + age, 'idle')
    samples.push({
      age,
      source: runtime.debugSignals().gazeSource,
      eyeX: output[3].translation.x,
      eyeY: output[3].translation.y,
      headRotation: output[2].rotation,
      hairRotation: output[6].rotation,
    })
  }

  const acquiredIndex = samples.findIndex(({ source }) => source === 'pointer')
  assert.ok(acquiredIndex > 0, 'pointer acquisition waits for recenter')
  const beforeAcquire = samples.slice(0, acquiredIndex)
  assert.ok(beforeAcquire.at(-1)!.age >= 380)
  assert.ok(
    beforeAcquire.every(({ eyeX }) => eyeX * pointerDirection < 0.0005),
    'eyes do not cut across centre toward the pointer during recenter',
  )
  assert.ok(
    Math.abs(beforeAcquire.at(-1)!.eyeX) <
      Math.abs(sidePose[3].translation.x) * 0.22,
  )
  assert.ok(
    beforeAcquire.every(
      (sample, index) =>
        sample.headRotation * pointerDirection < 0.0015 &&
        (index === 0 ||
          Math.abs(
            sample.headRotation - beforeAcquire[index - 1].headRotation,
          ) < 0.002),
    ),
    'head settles on its existing side before it turns toward the pointer',
  )
  assert.ok(
    beforeAcquire.every(
      (sample, index) =>
        index === 0 ||
        Math.abs(sample.hairRotation - beforeAcquire[index - 1].hairRotation) <
          0.01,
    ),
    'hair follows the neutral return without a one-frame cut',
  )
  assert.ok(samples.at(-1)!.eyeX * pointerDirection > 0.003)
  assert.ok(
    samples.at(-1)!.eyeY > 0.001,
    'continuous pointer updates keep the latest pending target without restarting recenter',
  )
})

test('pointer leaving during glance recenter never acquires its stale position', () => {
  const runtime = new MotionRuntime(manifest)
  let glanceAt = -1
  let glanceDirection = 0
  for (let now = 0; now <= 8_000; now += 10) {
    runtime.applyInto(pose(), now, 'idle')
    const glance = runtime.debugSignals().idleGlance.x
    if (Math.abs(glance) > 0.12) {
      glanceAt = now
      glanceDirection = Math.sign(glance)
      break
    }
  }
  assert.ok(glanceAt >= 3_000)

  runtime.setGazeTarget(
    {
      x: -glanceDirection,
      y: 0.5,
      attention: 1,
      source: 'pointer',
    },
    glanceAt,
  )
  runtime.applyInto(pose(), glanceAt + 180, 'idle')
  runtime.setGazeTarget(null, glanceAt + 220, 'pointer')

  const sources: ReturnType<MotionRuntime['debugSignals']>['gazeSource'][] = []
  for (let age = 240; age <= 1_000; age += 20) {
    runtime.applyInto(pose(), glanceAt + age, 'idle')
    sources.push(runtime.debugSignals().gazeSource)
  }
  assert.equal(
    sources.includes('pointer'),
    false,
    'leaving clears the pending pointer before the recenter window expires',
  )
})

test('pointer release after stealing a glance returns to center before a new quiet interval', () => {
  const runtime = new MotionRuntime(manifest)
  let glanceAt = -1
  let glanceDirection = 0
  for (let now = 0; now <= 8_000; now += 10) {
    runtime.applyInto(pose(), now, 'idle')
    const glance = runtime.debugSignals().idleGlance.x
    if (Math.abs(glance) > 0.12) {
      glanceAt = now
      glanceDirection = Math.sign(glance)
      break
    }
  }
  assert.ok(glanceAt >= 3_000)

  const pointerDirection = -glanceDirection
  runtime.setGazeTarget(
    {
      x: pointerDirection,
      y: 0.18,
      attention: 1,
      source: 'pointer',
    },
    glanceAt,
  )
  let acquiredAt = -1
  let acquiredPose = pose()
  for (let age = 20; age <= 1_000; age += 20) {
    const output = pose()
    runtime.applyInto(output, glanceAt + age, 'idle')
    if (runtime.debugSignals().gazeSource === 'pointer') {
      acquiredAt = glanceAt + age
      acquiredPose = output
      break
    }
  }
  assert.ok(acquiredAt > glanceAt)
  for (let now = acquiredAt + 20; now <= acquiredAt + 640; now += 20) {
    acquiredPose = pose()
    runtime.applyInto(acquiredPose, now, 'idle')
  }
  assert.ok(acquiredPose[3].translation.x * pointerDirection > 0)

  const releasedAt = acquiredAt + 640
  runtime.setGazeTarget(null, releasedAt, 'pointer')
  const returnMagnitudes: number[] = []
  for (let age = 20; age < 3_000; age += 20) {
    const output = pose()
    runtime.applyInto(output, releasedAt + age, 'idle')
    assert.notEqual(runtime.debugSignals().gazeSource, 'idle-glance')
    assert.deepEqual(runtime.debugSignals().idleGlance, { x: 0, y: 0 })
    if (age <= 720) returnMagnitudes.push(Math.abs(output[3].translation.x))
  }
  assert.ok(
    returnMagnitudes.at(-1)! < Math.abs(acquiredPose[3].translation.x) * 0.45,
    'the pointer follower returns near center before ambient glance can resume',
  )

  let resumedAt = -1
  for (let age = 3_000; age <= 8_200; age += 20) {
    runtime.applyInto(pose(), releasedAt + age, 'idle')
    if (runtime.debugSignals().gazeSource === 'idle-glance') {
      resumedAt = releasedAt + age
      break
    }
  }
  assert.ok(resumedAt >= releasedAt + 3_000)
})

test('explicit gaze cancels a side-glance blink that has not begun', () => {
  const runtime = new MotionRuntime(manifest)
  let interruptedAt = -1
  for (let now = 0; now <= 8_000; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    if (Math.abs(runtime.signals(now, 'idle').idleGlanceX) > 0.002) {
      interruptedAt = now
      break
    }
  }
  assert.ok(interruptedAt >= 3_000)

  runtime.setGazeTarget(
    { x: -1, y: -0.2, attention: 1, source: 'pointer' },
    interruptedAt,
  )
  let minimumEyeScale = 1
  for (let now = interruptedAt + 10; now <= interruptedAt + 800; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    minimumEyeScale = Math.min(minimumEyeScale, output[3].scale.y)
  }
  assert.ok(
    minimumEyeScale > 0.95,
    'the abandoned glance does not leave a delayed blink on pointer gaze',
  )
})

test('idle side glance reaches its hold before the coordinated blink', () => {
  const runtime = new MotionRuntime(manifest)
  const samples: Array<{ now: number; glance: number; eyeScale: number }> = []
  for (let now = 0; now <= 10_000; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    samples.push({
      now,
      glance: Math.abs(runtime.signals(now, 'idle').idleGlanceX),
      eyeScale: output[3].scale.y,
    })
  }

  const maximum = Math.max(...samples.map((sample) => sample.glance))
  const arrived = samples.find((sample) => sample.glance >= maximum * 0.995)
  assert.ok(arrived && maximum >= 0.18)
  const blink = samples.find(
    (sample) => sample.now > arrived.now && sample.eyeScale < 0.8,
  )
  assert.ok(blink, 'the held glance includes a coordinated soft blink')
  assert.ok(
    blink.now >= arrived.now + 120,
    'the eyelids wait for a visible settled hold after arrival',
  )
  assert.ok(
    samples
      .filter(
        (sample) =>
          sample.now >= arrived.now - 120 && sample.now < arrived.now + 100,
      )
      .every((sample) => sample.eyeScale > 0.95),
    'the arrival sweep stays fully open-eyed',
  )
  assert.ok(
    Math.abs(blink.glance - maximum) < 0.001,
    'the gaze is stationary while the blink closes',
  )
})

test('idle glance hair keeps a small delayed tail after the head returns', () => {
  const runtime = new MotionRuntime(manifest)
  let direction = 0
  let wasActive = false
  let returnedAt = -1
  let returnedPose = pose()
  const postReturn: RigTransform[][] = []

  for (let now = 0; now <= 10_000; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    const glance = runtime.signals(now, 'idle').idleGlanceX
    const active = Math.abs(glance) > 0.0001
    if (active && direction === 0) direction = Math.sign(glance)
    if (!active && wasActive && returnedAt < 0) {
      returnedAt = now
      returnedPose = output
    } else if (returnedAt >= 0 && now <= returnedAt + 128) {
      postReturn.push(output)
    }
    wasActive = active
  }

  assert.notEqual(direction, 0)
  assert.ok(returnedAt > 0)
  assert.ok(
    returnedPose[2].rotation * direction < 0,
    'the head has already crossed back through its ambient centre',
  )
  assert.ok(
    returnedPose[6].rotation * direction > 0.00055,
    'the hair still holds a subtle trace of the old glance direction',
  )
  assert.ok(
    postReturn.some((output) => output[6].rotation * direction > 0.00035),
    'the hair tail remains visible briefly after the head has returned',
  )
})

test('pre-rest fatigue makes side glances smaller, slower, and eye-led', () => {
  const alertStyle = idleGazeGlanceStyle(80)
  const tiredStyle = idleGazeGlanceStyle(35)
  assert.deepEqual(alertStyle, {
    amplitudeScale: 1,
    tempoScale: 1,
    headScale: 1,
  })
  assert.ok(tiredStyle.amplitudeScale <= 0.59)
  assert.ok(tiredStyle.tempoScale <= 0.63)
  assert.ok(tiredStyle.headScale <= 0.14)

  const measure = (energy: number) => {
    const runtime = new MotionRuntime(manifest)
    runtime.setCharacterState({ ...state, energy })
    runtime.setIdleBehaviorMode('idle')
    let startedAt = -1
    let arrivedAt = -1
    let maximum = 0
    const samples: Array<{ now: number; glance: number }> = []
    for (let now = 0; now <= 10_000; now += 10) {
      const glance = Math.abs(runtime.signals(now, 'idle').idleGlanceX)
      samples.push({ now, glance })
      maximum = Math.max(maximum, glance)
      if (startedAt < 0 && glance > 0.0001) startedAt = now
    }
    arrivedAt =
      samples.find(
        (sample) => sample.now >= startedAt && sample.glance >= maximum * 0.995,
      )?.now ?? -1
    return { maximum, acquireMs: arrivedAt - startedAt }
  }

  const alert = measure(80)
  const tired = measure(35)
  assert.ok(tired.maximum < alert.maximum * 0.62)
  assert.ok(tired.acquireMs > alert.acquireMs * 1.45)
})

test('procedural evaluation is deterministic for the same manifest and clock', () => {
  const left = new MotionRuntime(manifest)
  const right = new MotionRuntime(manifest)
  left.setCharacterState(state)
  right.setCharacterState(state)
  const leftPose = pose()
  const rightPose = pose()
  for (const now of [0, 16, 32, 500, 1_000, 3_000]) {
    left.applyInto(leftPose, now, 'idle')
    right.applyInto(rightPose, now, 'idle')
  }
  assert.deepEqual(leftPose, rightPose)
})

test('idle channels keep independent phases and low energy slows their cadence', () => {
  const tired = new MotionRuntime(manifest)
  const alert = new MotionRuntime(manifest)
  tired.setCharacterState({ ...state, energy: 5 })
  alert.setCharacterState({ ...state, energy: 95 })
  const tiredBreath: number[] = []
  const alertBreath: number[] = []
  const channels: number[][] = [[], [], [], []]

  for (let now = 0; now <= 12_000; now += 200) {
    const tiredSignals = tired.signals(now, 'idle')
    const alertSignals = alert.signals(now, 'idle')
    tiredBreath.push(tiredSignals.breath)
    alertBreath.push(alertSignals.breath)
    channels[0].push(alertSignals.breath)
    channels[1].push(alertSignals.weightShift)
    channels[2].push(alertSignals.gazeWander)
    channels[3].push(alertSignals.secondaryDrift)
  }

  const totalTravel = (values: number[]) =>
    values
      .slice(1)
      .reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0)
  const correlation = (left: number[], right: number[]) => {
    const numerator = left.reduce(
      (sum, value, index) => sum + value * right[index],
      0,
    )
    const magnitude = Math.sqrt(
      left.reduce((sum, value) => sum + value * value, 0) *
        right.reduce((sum, value) => sum + value * value, 0),
    )
    return numerator / magnitude
  }

  assert.ok(totalTravel(tiredBreath) < totalTravel(alertBreath))
  for (let left = 0; left < channels.length; left += 1) {
    for (let right = left + 1; right < channels.length; right += 1) {
      assert.ok(Math.abs(correlation(channels[left], channels[right])) < 0.9)
    }
  }
})

test('collapsed 10 FPS sampling preserves real-time breath and blink phase', () => {
  const dense = new MotionRuntime(manifest)
  const collapsed = new MotionRuntime(manifest)
  dense.setCharacterState(state)
  collapsed.setCharacterState(state)
  const reference = new Map<
    number,
    { breath: number; leftEyeScaleY: number; rightEyeScaleY: number }
  >()

  for (let now = 0; now <= 12_000; now += 10) {
    const output = pose()
    dense.applyInto(output, now, 'idle')
    if (now % 100 === 0) {
      reference.set(now, {
        breath: dense.signals(now, 'idle').breath,
        leftEyeScaleY: output[3].scale.y,
        rightEyeScaleY: output[4].scale.y,
      })
    }
  }

  for (let now = 0; now <= 12_000; now += 100) {
    const output = pose()
    collapsed.applyInto(output, now, 'idle')
    const expected = reference.get(now)!
    assert.ok(
      Math.abs(collapsed.signals(now, 'idle').breath - expected.breath) < 1e-9,
    )
    assert.ok(Math.abs(output[3].scale.y - expected.leftEyeScaleY) < 1e-9)
    assert.ok(Math.abs(output[4].scale.y - expected.rightEyeScaleY) < 1e-9)
  }
})

test('collapsed 10 FPS double-blink valley decisions match dense wall time', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 2.2,
    maxIntervalSeconds: 2.2,
    doubleChance: 1,
  }
  const dense = new MotionRuntime(manifest, profile)
  const collapsed = new MotionRuntime(manifest, profile)
  dense.setExpanded(false)
  collapsed.setExpanded(false)
  dense.setCharacterState(state)
  collapsed.setCharacterState(state)
  const reference = new Map<
    number,
    { breath: number; leftEyeScaleY: number; rightEyeScaleY: number }
  >()

  for (let now = 0; now <= 30_000; now += 10) {
    const output = pose()
    dense.applyInto(output, now, 'idle')
    if (now % 100 === 0) {
      reference.set(now, {
        breath: dense.signals(now, 'idle').breath,
        leftEyeScaleY: output[3].scale.y,
        rightEyeScaleY: output[4].scale.y,
      })
    }
  }

  let sampledClosures = 0
  for (let now = 0; now <= 30_000; now += 100) {
    const output = pose()
    collapsed.applyInto(output, now, 'idle')
    const expected = reference.get(now)!
    assert.ok(
      Math.abs(collapsed.signals(now, 'idle').breath - expected.breath) < 1e-9,
    )
    assert.ok(Math.abs(output[3].scale.y - expected.leftEyeScaleY) < 1e-9)
    assert.ok(Math.abs(output[4].scale.y - expected.rightEyeScaleY) < 1e-9)
    if (output[3].scale.y < 0.8) sampledClosures += 1
  }
  assert.ok(sampledClosures >= 8, 'the comparison crosses several blink pairs')
})

test('10 FPS and 60 FPS resolve identical blink-safe breathing windows', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 2.2,
    maxIntervalSeconds: 2.2,
    doubleChance: 1,
  }
  const dense = new MotionRuntime(manifest, profile)
  const sparse = new MotionRuntime(manifest, profile)
  dense.setExpanded(false)
  sparse.setExpanded(false)
  dense.setCharacterState(state)
  sparse.setCharacterState(state)
  const reference = new Map<
    number,
    {
      breathPhase: number
      nextBlinkSafe: boolean
      blinkClosure: number
    }
  >()

  for (let frame = 0; frame <= 1_800; frame += 1) {
    const now = (frame * 1_000) / 60
    dense.applyInto(pose(), now, 'idle')
    if (frame % 6 === 0) {
      const debug = dense.debugSignals()
      reference.set(frame / 6, {
        breathPhase: debug.breathPhase,
        nextBlinkSafe: debug.nextBlinkSafe,
        blinkClosure: debug.blinkClosure,
      })
    }
  }

  let comparedClosures = 0
  for (let sample = 0; sample <= 300; sample += 1) {
    sparse.applyInto(pose(), sample * 100, 'idle')
    const debug = sparse.debugSignals()
    const expected = reference.get(sample)!
    assert.ok(Math.abs(debug.breathPhase - expected.breathPhase) < 1e-9)
    assert.equal(debug.nextBlinkSafe, expected.nextBlinkSafe)
    assert.ok(Math.abs(debug.blinkClosure - expected.blinkClosure) < 1e-9)
    if (debug.blinkClosure > 0.5) comparedClosures += 1
  }
  assert.ok(comparedClosures >= 8, 'the comparison crosses several closures')
})

test('collapsed cadence exposes a precise closure-peak sample before the next 10 FPS tick', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setExpanded(false, 0)
  let sampledPeaks = 0
  for (let now = 0; now <= 30_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
    const peakDelay = runtime.nextBlinkPeakDelayMs(now, 100)
    if (peakDelay === null) continue
    runtime.applyInto(pose(), now + peakDelay, 'idle')
    assert.ok(
      runtime.debugSignals().blinkClosure > 0.999,
      'the inserted sample lands on the analytic lid peak',
    )
    runtime.applyInto(pose(), now + 100, 'idle')
    sampledPeaks += 1
  }
  assert.ok(sampledPeaks >= 4)
})

test('a missed collapsed tick advances breath, blink, and hair by at most 100ms', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 0.4,
    maxIntervalSeconds: 0.4,
    doubleChance: 0,
  }
  const reference = new MotionRuntime(manifest, profile)
  const delayed = new MotionRuntime(manifest, profile)
  for (const runtime of [reference, delayed]) {
    runtime.setCharacterState(state)
    runtime.setExpanded(false)
  }

  for (const now of [0, 100, 200, 300, 400, 500]) {
    reference.applyInto(pose(), now, 'idle')
    delayed.applyInto(pose(), now, 'idle')
  }
  const expected = pose()
  const actual = pose()
  reference.applyInto(expected, 600, 'idle')
  delayed.applyInto(actual, 1_250, 'idle')

  assert.ok(
    Math.abs(
      delayed.signals(1_250, 'idle').breath -
        reference.signals(600, 'idle').breath,
    ) < 1e-9,
    'breath consumes the measured slot without jumping the missed 650ms',
  )
  assert.ok(
    Math.abs(actual[3].scale.y - expected[3].scale.y) < 1e-9,
    'blink phase consumes the same bounded wall-clock slot',
  )
  assert.ok(
    Math.abs(actual[6].rotation - expected[6].rotation) < 1e-9,
    'hair spring integration stays on the same bounded wall-clock slot',
  )
})

test('a stale competing clock sample cannot rewind and double-consume runtime dt', () => {
  const reference = new MotionRuntime(manifest)
  const raced = new MotionRuntime(manifest)
  for (const runtime of [reference, raced]) {
    runtime.setCharacterState(state)
    runtime.applyInto(pose(), 0, 'idle')
    runtime.applyInto(pose(), 100, 'idle')
  }

  raced.applyInto(pose(), 90, 'idle')
  const expected = pose()
  const actual = pose()
  reference.applyInto(expected, 200, 'idle')
  raced.applyInto(actual, 200, 'idle')

  assert.ok(
    Math.abs(
      raced.debugSignals().breathPhase - reference.debugSignals().breathPhase,
    ) < 1e-12,
  )
  assert.ok(Math.abs(actual[6].rotation - expected[6].rotation) < 1e-12)
})

test('macro idle variation does not reveal the authored ten-second loop', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, boredom: 82 })
  const signatures = new Set<string>()
  let previousAccent = 0
  let maximumAccentStep = 0
  for (let now = 0; now <= 80_000; now += 16) {
    const signals = runtime.signals(now, 'idle')
    if (now > 0) {
      maximumAccentStep = Math.max(
        maximumAccentStep,
        Math.abs(signals.idleAccent - previousAccent),
      )
    }
    previousAccent = signals.idleAccent
    if (now > 0 && now % 10_000 === 0) {
      signatures.add(
        [signals.shoulderDrift, signals.headDrift, signals.idleAccent]
          .map((value) => value.toFixed(3))
          .join(':'),
      )
    }
  }
  assert.ok(
    signatures.size >= 7,
    'macro posture keeps changing across loop laps',
  )
  assert.ok(maximumAccentStep < 0.01, 'macro accents keep a continuous slope')
})

test('energy changes retime independent clocks without resetting their phase', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 90 })
  runtime.signals(0, 'idle')
  const before = { ...runtime.signals(5_000, 'idle') }
  runtime.setCharacterState({ ...state, energy: 8 })
  const after = runtime.signals(5_016, 'idle')

  assert.ok(Math.abs(after.breath - before.breath) < 0.04)
  assert.ok(Math.abs(after.weightShift - before.weightShift) < 0.04)
  assert.ok(Math.abs(after.gazeWander - before.gazeWander) < 0.04)
  assert.ok(Math.abs(after.secondaryDrift - before.secondaryDrift) < 0.04)
})

test('extreme state changes follow monotonically without spring overshoot', () => {
  let energy = 0.95
  let boredom = 0.02
  const energySamples: number[] = []
  const boredomSamples: number[] = []
  for (let frame = 0; frame < 240; frame += 1) {
    energy = boundedStateFollow(energy, 0.02, 1 / 60, 3.8)
    boredom = boundedStateFollow(boredom, 1, 1 / 60, 2.6)
    energySamples.push(energy)
    boredomSamples.push(boredom)
  }
  assert.ok(energySamples.every((value) => value >= 0.02 && value <= 0.95))
  assert.ok(boredomSamples.every((value) => value >= 0.02 && value <= 1))
  assert.ok(
    energySamples
      .slice(1)
      .every((value, index) => value <= energySamples[index]),
  )
  assert.ok(
    boredomSamples
      .slice(1)
      .every((value, index) => value >= boredomSamples[index]),
  )
})

test('idle handwear and head layers evolve independently over a long cycle', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, boredom: 90 })
  const samples: number[][] = []
  const unownedHandwearMotion: number[] = []
  for (let now = 0; now <= 65_000; now += 1_000) {
    const output = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(output, now, 'idle')
    if (!runtime.idleGlanceActive(now)) {
      unownedHandwearMotion.push(Math.abs(output[8].rotation))
    }
    if (now % 10_000 === 0) {
      samples.push([output[2].rotation, output[8].rotation])
    }
  }
  assert.ok(
    Math.max(...unownedHandwearMotion) > 0.001,
    'whole-layer handwear retains a subtle independent delayed accent',
  )
  assert.ok(
    new Set(
      samples.map((sample) =>
        sample.map((value) => value.toFixed(3)).join(':'),
      ),
    ).size >= 6,
  )
})

test('long idle occasionally pairs two distinct soft blinks', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 55, boredom: 82 })
  const blinkStarts: number[] = []
  let wasClosed = false
  for (let now = 0; now <= 80_000; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    const closed = output[3].scale.y < 0.6
    if (closed && !wasClosed) blinkStarts.push(now)
    wasClosed = closed
  }
  const pairedGaps = blinkStarts
    .slice(1)
    .map((start, index) => start - blinkStarts[index])
    .filter((gap) => gap >= 180 && gap <= 700)
  assert.ok(pairedGaps.length > 0, 'the long idle contains a true double blink')
})

test('blink closures defer past the breathing trough without resetting breath', () => {
  assert.equal(blinkBreathValleyDelaySeconds(0, 0.2, 0), 0)
  assert.ok(blinkBreathValleyDelaySeconds(Math.PI * 1.5, 0.2, 0) > 0)

  const runtime = new MotionRuntime(manifest)
  const closures: number[] = []
  let previousEyeScale = 1
  let previousBreath = 0
  let falling = false
  for (let now = 0; now <= 90_000; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    const eyeScale = output[3].scale.y
    const breath = runtime.signals(now, 'idle').breath
    if (eyeScale < previousEyeScale) falling = true
    if (falling && eyeScale > previousEyeScale) {
      closures.push(previousBreath)
      falling = false
    }
    previousEyeScale = eyeScale
    previousBreath = breath
  }

  assert.ok(closures.length >= 8)
  assert.ok(
    closures.every((breath) => breath > -0.55),
    'maximum lid closure never stacks on the exhale trough',
  )
})

test('both closures of a double blink stay outside the breathing trough', () => {
  const frequencyHz = 1.925
  const duration = 0.24
  const secondStartOffset = duration * 1.18
  const secondDuration = duration * 0.78
  const delay = blinkBreathSequenceDelaySeconds(
    0,
    frequencyHz,
    duration * 0.5,
    secondStartOffset + secondDuration * 0.5,
  )

  assert.equal(
    blinkBreathValleyDelaySeconds(0, frequencyHz, delay + duration * 0.5),
    0,
  )
  assert.equal(
    blinkBreathValleyDelaySeconds(
      0,
      frequencyHz,
      delay + secondStartOffset + secondDuration * 0.5,
    ),
    0,
  )
})

test('translating a deferred double blink preserves its authored start gap', () => {
  assert.ok(
    Math.abs(translatedDoubleBlinkSecondStart(2.4, 2.6832, 4.1) - 4.3832) <
      1e-12,
  )
})

test('double-blink breath separation is safe across authored rates and phases', () => {
  const duration = 0.24
  const primaryPeakOffset = duration * 0.5
  const secondaryPeakOffset = duration * 1.18 + duration * 0.78 * 0.5
  for (let frequencyHz = 0.05; frequencyHz <= 4; frequencyHz += 0.05) {
    for (let phaseStep = 0; phaseStep < 128; phaseStep += 1) {
      const phase = (phaseStep / 128) * Math.PI * 2
      const delay = blinkBreathSequenceDelaySeconds(
        phase,
        frequencyHz,
        primaryPeakOffset,
        secondaryPeakOffset,
      )
      assert.ok(Number.isFinite(delay) && delay >= 0)
      assert.equal(
        blinkBreathValleyDelaySeconds(
          phase,
          frequencyHz,
          delay + primaryPeakOffset,
        ),
        0,
      )
      assert.equal(
        blinkBreathValleyDelaySeconds(
          phase,
          frequencyHz,
          delay + secondaryPeakOffset,
        ),
        0,
      )
    }
  }
})

test('a head-turn gate translates a deferred double blink as one rhythmic group', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 2.2,
    maxIntervalSeconds: 2.2,
    doubleChance: 1,
  }
  const reference = new MotionRuntime(manifest, profile)
  let referenceFirstClosureAt = -1
  for (let now = 0; now <= 12_000; now += 5) {
    const output = pose()
    reference.applyInto(output, now, 'idle')
    if (output[3].scale.y < 0.92) {
      referenceFirstClosureAt = now
      break
    }
  }
  assert.ok(referenceFirstClosureAt > 200)

  const runtime = new MotionRuntime(manifest, profile)
  const closures: Array<{ at: number; breath: number }> = []
  const turnAt = referenceFirstClosureAt - 100
  let pointerInterrupted = false
  let previousEyeScale = 1
  let previousBreath = 0
  let falling = false

  for (let now = 0; now <= 12_000; now += 5) {
    if (!pointerInterrupted && now >= turnAt) {
      runtime.setGazeTarget(
        { x: 1, y: -0.35, attention: 1, source: 'pointer' },
        now,
      )
      pointerInterrupted = true
    }
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    const eyeScale = output[3].scale.y
    const breath = runtime.signals(now, 'idle').breath
    if (eyeScale < previousEyeScale) falling = true
    if (falling && eyeScale > previousEyeScale) {
      closures.push({ at: now - 5, breath: previousBreath })
      falling = false
    }
    previousEyeScale = eyeScale
    previousBreath = breath
  }

  assert.equal(pointerInterrupted, true)
  assert.ok(closures.length >= 2, 'the deferred second closure still lands')
  assert.ok(
    closures.every(({ breath }) => breath > -0.55),
    'the active and gate-deferred closures both remain outside the trough',
  )
  assert.ok(
    closures[0].at > referenceFirstClosureAt + 100,
    'the turn visibly postpones the first closure',
  )
  const authoredPeakGap =
    profile.blink.durationSeconds * (1.18 + 0.78 * 0.5 - 0.5)
  assert.ok(
    Math.abs(closures[1].at - closures[0].at - authoredPeakGap * 1_000) <= 110,
    'the visible beats remain inside one compact double-blink rhythm',
  )
  assert.ok(
    closures.length < 3 || closures[2].at - closures[1].at >= 1_000,
    'the next independent blink remains clearly separated from the pair',
  )
})

test('rest suppresses handwear, breath, and ambient gaze while wake-up ramps slowly', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const resting = new MotionRuntime(layeredManifest)
  const alert = new MotionRuntime(layeredManifest)
  resting.setCharacterState({ ...state, energy: 5, boredom: 80 })
  alert.setCharacterState({ ...state, energy: 85, boredom: 80 })

  let restHandwearTravel = 0
  let alertHandwearTravel = 0
  let restBodyTravel = 0
  let alertBodyTravel = 0
  let previousRest = 0
  let previousAlert = 0
  let previousRestBody = 0
  let previousAlertBody = 0
  for (let now = 0; now <= 8_000; now += 100) {
    const restPose = layeredManifest.bones.map(() => pose()[0])
    const alertPose = layeredManifest.bones.map(() => pose()[0])
    resting.applyInto(restPose, now, 'idle')
    alert.applyInto(alertPose, now, 'idle')
    restHandwearTravel += Math.abs(restPose[8].rotation - previousRest)
    alertHandwearTravel += Math.abs(alertPose[8].rotation - previousAlert)
    restBodyTravel += Math.abs(restPose[1].translation.y - previousRestBody)
    alertBodyTravel += Math.abs(alertPose[1].translation.y - previousAlertBody)
    previousRest = restPose[8].rotation
    previousAlert = alertPose[8].rotation
    previousRestBody = restPose[1].translation.y
    previousAlertBody = alertPose[1].translation.y
  }
  assert.ok(restHandwearTravel < alertHandwearTravel * 0.45)
  assert.ok(restBodyTravel < alertBodyTravel * 0.8)
  assert.ok(resting.signals(8_016, 'idle').restWeight > 0.9)

  resting.setCharacterState({ ...state, energy: 85, boredom: 80 })
  const earlyWake = resting.signals(8_032, 'idle').restWeight
  let midWake = earlyWake
  let lateWake = earlyWake
  for (let now = 8_132; now <= 18_032; now += 100) {
    const weight = resting.signals(now, 'idle').restWeight
    if (now === 10_032) midWake = weight
    lateWake = weight
  }
  assert.ok(earlyWake > 0.98, 'wake-up starts from the resting cadence')
  assert.ok(midWake > 0.35, 'idle activity returns gradually')
  assert.ok(
    lateWake < 0.05,
    'the character eventually reaches full idle motion',
  )
})

test('explicit rest mode enters and leaves through a continuous posture envelope', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 20 })
  runtime.setIdleBehaviorMode('idle')
  runtime.applyInto(pose(), 0, 'idle')
  runtime.applyInto(pose(), 100, 'idle')
  runtime.setIdleBehaviorMode('rest')
  const entered = runtime.signals(116, 'idle').restWeight
  let resting = entered
  for (let now = 132; now <= 4_000; now += 16) {
    resting = runtime.signals(now, 'idle').restWeight
  }
  runtime.setIdleBehaviorMode('idle')
  const leaving = runtime.signals(4_016, 'idle').restWeight

  assert.ok(entered > 0 && entered < 0.1, 'rest does not cut in on one frame')
  assert.ok(resting > 0.95, 'rest reaches its held posture')
  assert.ok(leaving < resting && leaving > 0.9, 'wake-up begins without a cut')
})

test('rest-to-idle secondary damping unloads continuously before full spring response', () => {
  const resting = secondarySpringDynamics(1, 1.08, 0.74)
  const earlyWake = secondarySpringDynamics(0.9, 1.08, 0.74)
  const midWake = secondarySpringDynamics(0.5, 1.08, 0.74)
  const idle = secondarySpringDynamics(0, 1.08, 0.74)

  assert.equal(resting.wakeWeight, 0)
  assert.equal(idle.wakeWeight, 1)
  assert.ok(resting.dampingScale > earlyWake.dampingScale)
  assert.ok(earlyWake.dampingScale > midWake.dampingScale)
  assert.ok(midWake.dampingScale > idle.dampingScale)
  assert.ok(resting.frequencyScale < earlyWake.frequencyScale)
  assert.ok(earlyWake.frequencyScale < midWake.frequencyScale)
  assert.ok(midWake.frequencyScale < idle.frequencyScale)
  assert.ok(
    earlyWake.wakeWeight < 0.04,
    'the first wake fraction cannot inject a full ambient spring target',
  )

  const delayedWake = secondarySpringDynamics(0.5, 1.08, 0.74, 0.08)
  assert.equal(delayedWake.wakeWeight, 0.08)
  assert.ok(delayedWake.dampingScale > midWake.dampingScale)
  assert.ok(delayedWake.frequencyScale < midWake.frequencyScale)
  assert.ok(
    delayedWake.dampingScale < resting.dampingScale &&
      delayedWake.frequencyScale > resting.frequencyScale,
    'solver parameters loosen from rest on the explicit wake envelope',
  )
})

test('rest stillness continuously ramps shoulder amplitude and procedural phase rates', () => {
  const stillness = [1, 0.9, 0.7, 0.5, 0.3, 0.1, 0]
  const shoulderAmplitudes = stillness.map(restWakeAmplitudeScale)
  const macroRates = stillness.map((value) => restPhaseRateScale(value, 0.08))
  const secondaryRates = stillness.map((value) =>
    restPhaseRateScale(value, 0.12),
  )

  assert.equal(shoulderAmplitudes[0], 0)
  assert.equal(shoulderAmplitudes.at(-1), 1)
  assert.equal(macroRates[0], 0.08)
  assert.equal(macroRates.at(-1), 1)
  assert.equal(secondaryRates[0], 0.12)
  assert.equal(secondaryRates.at(-1), 1)
  for (const rates of [shoulderAmplitudes, macroRates, secondaryRates]) {
    assert.ok(
      rates.every((rate, index) => index === 0 || rate > rates[index - 1]),
      'wake drive rises on every sampled restStillness step',
    )
    assert.ok(
      rates.slice(1).every((rate, index) => rate - rates[index] < 0.35),
      'the wake envelope has no threshold-sized jump',
    )
  }
})

test('rest-to-idle handwear sway leaves zero continuously before reaching idle amplitude', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 88 })
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 8_000; now += 16) {
    runtime.applyInto(
      layeredManifest.bones.map(() => pose()[0]),
      now,
      'idle',
    )
  }

  runtime.setIdleBehaviorMode('idle', 8_000)
  const early: number[] = []
  const settled: number[] = []
  const stillness: number[] = []
  for (let now = 8_016; now <= 11_200; now += 16) {
    const output = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(output, now, 'idle')
    const magnitude = Math.abs(output[8].rotation)
    if (now <= 8_176) early.push(magnitude)
    if (now >= 10_400) settled.push(magnitude)
    stillness.push(runtime.debugSignals().restStillness)
  }

  assert.ok(stillness[0] > 0.95)
  assert.ok(
    stillness.every(
      (value, index) => index === 0 || value < stillness[index - 1],
    ),
    'restStillness unloads continuously throughout the wake',
  )
  assert.ok(
    Math.max(...early) < Math.max(...settled) * 0.08,
    'the first wake frames retain only a small fraction of idle handwear sway',
  )
})

test('handwear weight shift yields at breath peaks and returns between breaths', () => {
  assert.equal(shoulderWeightShiftPhaseScale(0), 1)
  assert.equal(shoulderWeightShiftPhaseScale(1), 0.12)
  assert.equal(shoulderWeightShiftPhaseScale(-1), 0.12)
  assert.ok(
    shoulderWeightShiftPhaseScale(0.25) > shoulderWeightShiftPhaseScale(0.75),
  )

  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 72, boredom: 84 })
  const atBreathPeak: number[] = []
  const betweenBreaths: number[] = []
  const bodyAtBreathPeak: number[] = []
  const bodyBetweenBreaths: number[] = []
  for (let now = 0; now <= 30_000; now += 10) {
    const output = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(output, now, 'idle')
    const breath = Math.abs(runtime.signals(now, 'idle').breath)
    const weightShift = Math.abs(output[8].rotation)
    if (breath >= 0.98) {
      atBreathPeak.push(weightShift)
      bodyAtBreathPeak.push(Math.abs(output[1].rotation))
    }
    if (breath <= 0.02) {
      betweenBreaths.push(weightShift)
      bodyBetweenBreaths.push(Math.abs(output[1].rotation))
    }
  }
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length

  assert.ok(atBreathPeak.length > 20)
  assert.ok(betweenBreaths.length > 20)
  assert.ok(
    average(betweenBreaths) > average(atBreathPeak) * 3,
    'the handwear changes weight between breaths instead of cresting with them',
  )
  assert.ok(
    average(bodyBetweenBreaths) > average(bodyAtBreathPeak) * 3,
    'the torso cannot carry an in-phase weight shift back into handwear',
  )
})

test('10 FPS collapsed rest expansion does not inject full idle spring drive', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 6, boredom: 72 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false)
  let resting = pose()
  for (let now = 0; now <= 20_000; now += 100) {
    resting = pose()
    runtime.applyInto(resting, now, 'idle')
  }
  const restingHair = resting[6].rotation

  runtime.setExpanded(true)
  assert.equal(runtime.requestWake(20_000), true)
  const wakeHair: number[] = []
  for (let now = 20_100; now <= 20_500; now += 100) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    wakeHair.push(output[6].rotation)
  }

  assert.ok(
    Math.abs(wakeHair[0] - restingHair) < 0.004,
    'the first expanded sample stays on the retained rest spring envelope',
  )
  assert.ok(
    wakeHair.every(
      (value, index) =>
        index === 0 || Math.abs(value - wakeHair[index - 1]) < 0.012,
    ),
    '10 FPS wake samples ramp spring drive without a one-frame kick',
  )
})

test('collapsed low-energy hair and cloth unload spring dynamics continuously on expansion', () => {
  const layeredManifest = {
    ...manifest,
    bones: [
      ...manifest.bones,
      { id: 'skirt-cloth', parent: 'body' },
      { id: 'coat-cloth', parent: 'skirt-cloth' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 5, boredom: 76 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false, 0)
  let previous = layeredManifest.bones.map(() => pose()[0])
  for (let now = 0; now <= 16_000; now += 100) {
    previous = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(previous, now, 'idle')
  }

  runtime.setExpanded(true, 16_000)
  assert.equal(runtime.prepareExpansion(16_000), true)
  const stillness: number[] = []
  const dynamics: ReturnType<typeof secondarySpringDynamics>[] = []
  const hairSteps: number[] = []
  const clothSteps: number[] = []
  let previousHair = previous[6].rotation
  let previousCloth = previous[9].rotation
  for (let now = 16_016; now <= 16_640; now += 16) {
    const output = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(output, now, 'idle')
    const restStillness = runtime.debugSignals().restStillness
    stillness.push(restStillness)
    dynamics.push(secondarySpringDynamics(restStillness, 1.08, 0.64))
    hairSteps.push(Math.abs(output[6].rotation - previousHair))
    clothSteps.push(Math.abs(output[9].rotation - previousCloth))
    previousHair = output[6].rotation
    previousCloth = output[9].rotation
  }

  assert.ok(
    stillness.every(
      (value, index) => index === 0 || value < stillness[index - 1],
    ),
    'restStillness unloads on every expanded frame',
  )
  assert.ok(
    dynamics.every(
      (value, index) =>
        index === 0 ||
        (value.frequencyScale > dynamics[index - 1].frequencyScale &&
          value.dampingScale < dynamics[index - 1].dampingScale),
    ),
    'hair and cloth frequency and damping stay on the same continuous envelope',
  )
  assert.ok(Math.max(...hairSteps) < 0.004)
  assert.ok(Math.max(...clothSteps) < 0.004)
  assert.ok(
    hairSteps[0] < Math.max(...hairSteps.slice(1)) &&
      clothSteps[0] < Math.max(...clothSteps.slice(1)),
    'the first expanded sample retains the soft collapsed spring before waking',
  )
})

test('expanding from rest uses wake without adding camera gaze or fidget', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 80 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false)
  for (let now = 0; now <= 8_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
  }

  runtime.setGazeTarget(
    { x: 0, y: -0.12, attention: 1, source: 'camera' },
    8_000,
  )
  runtime.setGazeTarget(
    { x: -0.4, y: 0.1, attention: 0.7, source: 'performance' },
    8_000,
  )
  runtime.setExpanded(true)
  assert.equal(runtime.prepareExpansion(8_000), true)
  assert.equal(runtime.wakeReadyDelayMs(8_000), 820)
  const fidgetInterval = idleAccentCooldownMs({ boredom: 80 }, 'fidget')
  assert.equal(runtime.ambientFidgetReadyDelayMs(8_000), fidgetInterval)
  runtime.applyInto(pose(), 8_016, 'idle')
  assert.equal(runtime.debugSignals().gazeSource, 'ambient')
  assert.equal(runtime.idleGlanceActive(8_016), false)
  runtime.setExpanded(false)
  runtime.setExpanded(true)
  assert.equal(runtime.requestWake(8_032), true)
  assert.equal(
    runtime.wakeReadyDelayMs(8_032),
    788,
    'the deferred greeting joins the existing wake instead of restarting it',
  )
  assert.equal(runtime.ambientFidgetReadyDelayMs(8_032), fidgetInterval - 32)

  for (let now = 8_048; now <= 8_816; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
    assert.equal(runtime.debugSignals().gazeSource, 'ambient')
    assert.equal(runtime.idleGlanceActive(now), false)
    assert.ok(runtime.ambientFidgetReadyDelayMs(now) > 0)
  }
})

test('the first click after three idle minutes keeps one wake-gated greeting', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 82 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false)
  const clickedAt = 180_100
  for (let now = 0; now <= clickedAt; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
  }

  runtime.setExpanded(true)
  assert.equal(runtime.prepareExpansion(clickedAt), true)
  assert.equal(runtime.wakeReadyDelayMs(clickedAt), 820)

  const greetingAt = clickedAt + 32
  assert.equal(runtime.requestWake(greetingAt), true)
  assert.equal(
    runtime.wakeReadyDelayMs(greetingAt),
    788,
    'the greeting joins the expansion wake gate instead of starting a new one',
  )

  let pendingPriorities: number[] = []
  for (let click = 0; click < 12; click += 1) {
    if (
      canSupersedePendingWakeActions(
        pendingPriorities,
        RIG_ACTION_PRIORITY.greeting,
      )
    ) {
      // Renderer cancellation replaces the accepted timer; equal-priority
      // clicks coalesce to the latest cue rather than extending this array.
      pendingPriorities = [RIG_ACTION_PRIORITY.greeting]
    }
  }
  assert.deepEqual(pendingPriorities, [RIG_ACTION_PRIORITY.greeting])
  assert.equal(
    canSupersedePendingWakeActions(pendingPriorities, 76),
    false,
    'a lower-priority click cannot queue behind the wake-gated greeting',
  )
})

test('a wake-deferred expansion greeting leaves its first idle breath visible', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 72 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false)
  let collapsed = pose()
  for (let now = 0; now <= 8_000; now += 100) {
    collapsed = pose()
    runtime.applyInto(collapsed, now, 'idle')
  }

  const collapsedHair = collapsed[6].rotation
  runtime.setExpanded(true)
  assert.equal(runtime.requestWake(8_000), true)
  assert.equal(runtime.wakeReadyDelayMs(8_000), 820)
  const breathSamples: number[] = []
  const hairSamples: number[] = []
  for (let now = 8_016; now < 8_820; now += 16) {
    const output = pose()
    // The greeting has yielded to wake here, so it does not own idle yet.
    runtime.applyInto(
      output,
      now,
      'idle',
      undefined,
      undefined,
      false,
    )
    breathSamples.push(output[1].translation.y)
    hairSamples.push(output[6].rotation)
  }

  assert.ok(
    Math.max(...breathSamples) - Math.min(...breathSamples) > 0.0005,
    'idle breathing is readable while the greeting waits behind wake',
  )
  assert.ok(
    Math.abs(hairSamples[0] - collapsedHair) < 0.004,
    'the first expanded hair frame keeps the collapsed angular phase',
  )
  assert.ok(
    hairSamples.every(
      (value, index) =>
        index === 0 || Math.abs(value - hairSamples[index - 1]) < 0.012,
    ),
    'the wake window contains no first-frame hair kick',
  )
  assert.equal(runtime.debugSignals().locksIdle, false)
})

test('greeting idle lock takes shoulder ownership at every wake depth', () => {
  assert.equal(idleLockAllowsShoulderMacro(true, true, 1), false)
  assert.equal(idleLockAllowsShoulderMacro(true, true, 0.3), false)
  assert.equal(idleLockAllowsShoulderMacro(true, true, 0.026), false)
  assert.equal(idleLockAllowsShoulderMacro(true, true, 0.025), false)
  assert.equal(idleLockAllowsShoulderMacro(true, true, 0), false)
  assert.equal(idleLockAllowsShoulderMacro(true, false, 0), true)
  assert.equal(idleLockAllowsShoulderMacro(false, false, 1), false)
})

test('greeting release gives idle glance a full quiet interval before it can turn the head again', () => {
  const runtime = new MotionRuntime(manifest)
  let lockedAt = -1
  for (let now = 0; now <= 10_000; now += 20) {
    runtime.applyInto(pose(), now, 'idle')
    if (runtime.idleGlanceActive(now)) {
      lockedAt = now
      break
    }
  }
  assert.ok(lockedAt >= 3_000, 'the greeting interrupts a live idle glance')

  for (let now = lockedAt + 20; now <= lockedAt + 2_000; now += 20) {
    runtime.applyInto(
      pose(),
      now,
      'idle',
      undefined,
      undefined,
      true,
    )
    assert.equal(runtime.idleGlanceActive(now), false)
    assert.deepEqual(runtime.debugSignals().idleGlance, { x: 0, y: 0 })
  }

  const releasedAt = lockedAt + 2_020
  runtime.applyInto(pose(), releasedAt, 'idle')
  for (let now = releasedAt + 20; now < releasedAt + 3_000; now += 20) {
    runtime.applyInto(pose(), now, 'idle')
    assert.equal(
      runtime.idleGlanceActive(now),
      false,
      'idle glance cannot immediately reclaim the head after locksIdle yields',
    )
  }

  let nextGlanceAt = -1
  for (let now = releasedAt + 3_000; now <= releasedAt + 8_200; now += 20) {
    runtime.applyInto(pose(), now, 'idle')
    if (runtime.idleGlanceActive(now)) {
      nextGlanceAt = now
      break
    }
  }
  assert.ok(nextGlanceAt >= releasedAt + 3_000)
  assert.ok(nextGlanceAt <= releasedAt + 8_200)
})

test('wake and expansion handwear drive does not stack under a greeting', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 76 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false)
  for (let now = 0; now <= 8_000; now += 100) {
    runtime.applyInto(
      layeredManifest.bones.map(() => pose()[0]),
      now,
      'idle',
    )
  }

  runtime.setExpanded(true)
  assert.equal(runtime.requestWake(8_000), true)
  let wakePose = layeredManifest.bones.map(() => pose()[0])
  for (let now = 8_016; now < 8_820; now += 16) {
    wakePose = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(wakePose, now, 'idle')
  }
  assert.ok(
    Math.abs(wakePose[8].rotation) +
      Math.abs(wakePose[8].translation.y) >
      0.00001,
    'wake owns visible but restrained handwear follow-through before greeting',
  )

  const authoredGreeting = layeredManifest.bones.map(() => pose()[0])
  authoredGreeting[8].rotation = 0.024
  authoredGreeting[8].translation.y = -0.003
  const greetingMask = layeredManifest.bones.map((_, index) => index === 2)
  const greetingPriorities = layeredManifest.bones.map(
    () => RIG_ACTION_PRIORITY.greeting,
  )
  runtime.applyInto(
    authoredGreeting,
    8_820,
    'idle',
    greetingMask,
    greetingPriorities,
    true,
  )

  assert.ok(
    Math.abs(authoredGreeting[8].rotation - 0.024) < 0.002,
    'the previous handwear spring may finish a tiny bounded tail',
  )
  assert.ok(Math.abs(authoredGreeting[8].translation.x) < 0.0005)
  assert.ok(Math.abs(authoredGreeting[8].translation.y + 0.003) < 0.0001)
})

test('runtime debug signals expose rest, breath, and explicit idle ownership', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 5 })
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 4_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
  }
  assert.ok(runtime.debugSignals().restStillness > 0.99)
  assert.equal(runtime.debugSignals().breathAmplitudeScale, 1)
  assert.ok(runtime.debugSignals().breathPhase >= 0)
  assert.ok(runtime.debugSignals().breathPhase < 1)
  assert.equal(typeof runtime.debugSignals().nextBlinkSafe, 'boolean')
  assert.ok(runtime.debugSignals().blinkClosure >= 0)
  assert.ok(runtime.debugSignals().blinkClosure <= 1)
  assert.equal(runtime.debugSignals().locksIdle, false)

  runtime.applyInto(
    pose(),
    4_016,
    'idle',
    undefined,
    undefined,
    true,
  )
  assert.equal(runtime.debugSignals().locksIdle, true)
  for (let now = 4_032; now <= 4_432; now += 16) {
    runtime.applyInto(pose(), now, 'talking')
  }
  assert.ok(runtime.debugSignals().breathAmplitudeScale < 0.45)
})

test('blink diagnostics align normalized breath phase with safe closure peaks', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 2.2,
    maxIntervalSeconds: 2.2,
    doubleChance: 1,
  }
  const runtime = new MotionRuntime(manifest, profile)
  let closurePeaks = 0
  for (let now = 0; now <= 30_000; now += 5) {
    runtime.applyInto(pose(), now, 'idle')
    const signals = runtime.signals(now, 'idle')
    const debug = runtime.debugSignals()
    assert.ok(
      Math.abs(Math.sin(debug.breathPhase * Math.PI * 2) - signals.breath) <
        1e-9,
    )
    if (debug.blinkClosure < 0.99) continue
    closurePeaks += 1
    assert.equal(debug.nextBlinkSafe, true)
  }
  assert.ok(closurePeaks >= 8, 'diagnostics cross several paired closures')
})

test('runtime debug signals expose idle glance values and gaze arbitration source', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.applyInto(pose(), 0, 'idle')
  assert.deepEqual(runtime.debugSignals().idleGlance, { x: 0, y: 0 })
  assert.equal(runtime.debugSignals().gazeSource, 'ambient')

  let glanceAt = -1
  for (let now = 16; now <= 10_000; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
    if (runtime.debugSignals().gazeSource === 'idle-glance') {
      glanceAt = now
      break
    }
  }
  assert.ok(glanceAt > 0)
  assert.notEqual(runtime.debugSignals().idleGlance.x, 0)
  assert.notEqual(runtime.debugSignals().idleGlance.y, 0)

  runtime.setGazeTarget(
    { x: -0.7, y: -0.1, attention: 1, source: 'camera' },
    glanceAt,
  )
  runtime.applyInto(pose(), glanceAt + 16, 'idle')
  assert.deepEqual(runtime.debugSignals().idleGlance, { x: 0, y: 0 })
  assert.equal(runtime.debugSignals().gazeSource, 'camera')

  runtime.setGazeTarget(
    { x: -0.2, y: -0.3, attention: 1, source: 'performance' },
    glanceAt + 16,
  )
  runtime.applyInto(pose(), glanceAt + 32, 'idle')
  assert.equal(runtime.debugSignals().gazeSource, 'performance')

  runtime.setGazeTarget(
    { x: 0.8, y: -0.2, attention: 1, source: 'pointer' },
    glanceAt + 32,
  )
  runtime.applyInto(pose(), glanceAt + 48, 'idle')
  assert.equal(runtime.debugSignals().gazeSource, 'pointer')

  runtime.setGazeTarget(null, glanceAt + 48, 'pointer')
  runtime.applyInto(pose(), glanceAt + 64, 'idle')
  assert.equal(runtime.debugSignals().gazeSource, 'performance')

  runtime.setGazeTarget(null, glanceAt + 64, 'performance')
  runtime.applyInto(pose(), glanceAt + 80, 'idle')
  assert.equal(runtime.debugSignals().gazeSource, 'camera')

  runtime.setGazeTarget(null, glanceAt + 80, 'camera')
  runtime.applyInto(pose(), glanceAt + 96, 'idle')
  assert.equal(runtime.debugSignals().gazeSource, 'ambient')
})

test('slow energy recovery continuously unloads rest across the mode threshold', () => {
  assert.equal(restWeightFromEnergy(0.2), 1)
  assert.ok(restWeightFromEnergy(0.38) < 1)
  assert.ok(restWeightFromEnergy(0.48) < restWeightFromEnergy(0.38))
  assert.equal(restWeightFromEnergy(0.6), 0)

  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 20 })
  runtime.setIdleBehaviorMode('rest')
  let now = 0
  for (; now <= 4_000; now += 100) runtime.signals(now, 'idle')
  const weights = [runtime.signals(now, 'idle').restWeight]
  for (const energy of [34, 38, 42]) {
    runtime.setCharacterState({ ...state, energy })
    const end = now + 3_000
    for (; now <= end; now += 100) runtime.signals(now, 'idle')
    weights.push(runtime.signals(now, 'idle').restWeight)
  }
  assert.ok(
    weights.every(
      (weight, index) => index === 0 || weight < weights[index - 1],
    ),
  )

  const beforeModeExit = weights.at(-1)!
  runtime.setIdleBehaviorMode('idle')
  const afterModeExit = runtime.signals(now + 16, 'idle').restWeight
  assert.ok(afterModeExit < beforeModeExit)
  assert.ok(
    beforeModeExit - afterModeExit < 0.015,
    'crossing the behavior threshold cannot pop the rest posture',
  )
  for (let end = now + 16_000; now <= end; now += 100) {
    runtime.signals(now, 'idle')
  }
  assert.ok(runtime.signals(now, 'idle').restWeight < 0.05)
})

test('speech keeps the body wake gated while the mouth takes immediate ownership', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8 })
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 4_000; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
  }
  runtime.setSpeechArticulation(
    { energy: 0.8, viseme: 'wide', amount: 0.9 },
    4_000,
  )
  let first = pose()
  let waking = pose()
  let awake = pose()
  let firstRestWeight = 1
  let wakingRestWeight = 1
  let awakeRestWeight = 1
  for (let now = 4_016; now <= 4_896; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, now === 4_016 ? 'idle' : 'talking')
    const restWeight = runtime.signals(now + 0.001, 'talking').restWeight
    if (now === 4_016) {
      first = output
      firstRestWeight = restWeight
    }
    if (now === 4_480) {
      waking = output
      wakingRestWeight = restWeight
    }
    if (now === 4_896) {
      awake = output
      awakeRestWeight = restWeight
    }
  }

  assert.ok(first[5].scale.x > 1.12)
  assert.ok(first[5].scale.y < 0.96)
  assert.ok(Math.abs(waking[5].scale.x - first[5].scale.x) < 0.08)
  assert.ok(Math.abs(awake[5].scale.x - waking[5].scale.x) < 0.08)
  assert.ok(
    firstRestWeight > wakingRestWeight + 0.35,
    'the wake starts near the held rest posture',
  )
  assert.ok(
    wakingRestWeight < 0.55,
    'the torso is visibly lifting before speech',
  )
  assert.ok(
    awakeRestWeight < 0.3,
    'full visemes arrive after most rest is gone',
  )
})

test('wake-gated actions wait until the rest-to-awake gate is fully open', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8 })
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 4_000; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
  }

  assert.equal(runtime.requestWake(4_000), true)
  assert.equal(runtime.wakeReadyDelayMs(4_000), 820)
  assert.ok(runtime.inputWakeWeight(4_520) < 1)
  assert.equal(runtime.inputWakeWeight(4_820), 1)
  assert.equal(runtime.wakeReadyDelayMs(4_820), 0)
})

test('rest wake holds ambient fidgets for one complete fidget interval', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8 })
  runtime.setIdleBehaviorMode('rest')
  runtime.applyInto(pose(), 0, 'idle')

  assert.equal(runtime.requestWake(1_000), true)
  const interval = idleAccentCooldownMs(state, 'fidget')
  assert.equal(runtime.ambientFidgetReadyDelayMs(1_000), interval)
  assert.equal(runtime.ambientFidgetReadyDelayMs(1_000 + interval - 1), 1)
  assert.equal(runtime.ambientFidgetReadyDelayMs(1_000 + interval), 0)
})

test('rest mode exit restarts both glance and fidget cadence from zero', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 100 })
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 4_000; now += 20) {
    runtime.applyInto(pose(), now, 'idle')
  }

  runtime.setIdleBehaviorMode('fidget')
  const fidgetInterval = idleAccentCooldownMs({ boredom: 100 }, 'fidget')
  assert.equal(runtime.ambientFidgetReadyDelayMs(4_000), fidgetInterval)
  for (let now = 4_020; now < 7_020; now += 20) {
    assert.equal(runtime.signals(now, 'idle').idleGlanceX, 0)
  }
  assert.ok(runtime.ambientFidgetReadyDelayMs(4_000 + fidgetInterval - 1) > 0)
})

test('rest exit anchors the first fidget cooldown to the state transition time', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 8, boredom: 100 })
  runtime.setIdleBehaviorMode('rest', 0)
  for (let now = 0; now <= 4_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
  }

  const transitionedAt = 4_075
  const interval = idleAccentCooldownMs({ boredom: 100 }, 'fidget')
  runtime.setIdleBehaviorMode('fidget', transitionedAt)
  assert.equal(runtime.ambientFidgetReadyDelayMs(transitionedAt), interval)
  assert.equal(
    runtime.ambientFidgetReadyDelayMs(transitionedAt + interval - 1),
    1,
  )
  assert.equal(runtime.ambientFidgetReadyDelayMs(transitionedAt + interval), 0)
})

test('greeting release holds ambient fidgets for another 2.5 seconds', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.applyInto(
    pose(),
    1_000,
    'idle',
    undefined,
    undefined,
    true,
  )
  assert.equal(runtime.ambientFidgetReadyDelayMs(1_000), 0)

  runtime.applyInto(
    pose(),
    2_000,
    'idle',
    undefined,
    undefined,
    false,
  )
  assert.equal(WAKE_FIDGET_SETTLE_MS, 2_500)
  assert.equal(runtime.ambientFidgetReadyDelayMs(2_000), 2_500)
  assert.equal(runtime.ambientFidgetReadyDelayMs(4_499), 1)
  assert.equal(runtime.ambientFidgetReadyDelayMs(4_500), 0)
})

test('deep rest answers pointer and camera attention with eyes but not the head or body', () => {
  for (const source of ['pointer', 'camera'] as const) {
    const runtime = new MotionRuntime(manifest)
    runtime.setCharacterState({ ...state, energy: 8 })
    runtime.setIdleBehaviorMode('rest')
    for (let now = 0; now <= 4_000; now += 16) {
      runtime.applyInto(pose(), now, 'idle')
    }
    const heldRest = runtime.signals(4_000, 'idle').restWeight
    runtime.setGazeTarget({ x: 1, y: -0.2, attention: 1, source }, 4_000)
    const first = pose()
    runtime.applyInto(first, 4_016, 'idle')
    const waking = pose()
    runtime.applyInto(waking, 4_480, 'idle')
    const awake = pose()
    runtime.applyInto(awake, 4_900, 'idle')

    assert.ok(first[3].translation.x > 0)
    assert.ok(waking[3].translation.x > first[3].translation.x)
    assert.ok(awake[3].translation.x >= waking[3].translation.x)
    assert.ok(awake[3].translation.x > 0.004)
    assert.ok(Math.abs(awake[2].rotation) < 0.0015)
    assert.ok(runtime.signals(4_916, 'idle').restWeight >= heldRest - 0.001)
  }
})

test('settled rest keeps only breathing and isolated slow blinks', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 20, boredom: 95 })
  runtime.setIdleBehaviorMode('rest')

  let minimumBodyY = Number.POSITIVE_INFINITY
  let maximumBodyY = Number.NEGATIVE_INFINITY
  let maximumHeadRotation = 0
  let maximumHandwearRotation = 0
  let maximumHairRotation = 0
  let blinkStarts = 0
  let wasClosed = false
  for (let now = 0; now <= 30_000; now += 50) {
    const output = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(output, now, 'idle')
    if (now < 8_000) continue
    minimumBodyY = Math.min(minimumBodyY, output[1].translation.y)
    maximumBodyY = Math.max(maximumBodyY, output[1].translation.y)
    maximumHeadRotation = Math.max(
      maximumHeadRotation,
      Math.abs(output[2].rotation),
    )
    maximumHairRotation = Math.max(
      maximumHairRotation,
      Math.abs(output[6].rotation),
    )
    maximumHandwearRotation = Math.max(
      maximumHandwearRotation,
      Math.abs(output[8].rotation),
    )
    const closed = output[3].scale.y < 0.6
    if (closed && !wasClosed) blinkStarts += 1
    wasClosed = closed
  }

  assert.ok(maximumBodyY - minimumBodyY > 0.001, 'breathing remains visible')
  assert.ok(maximumHeadRotation < 0.00005, 'head macro drift is absent')
  assert.ok(maximumHandwearRotation < 0.00005, 'handwear sway settles')
  assert.ok(maximumHairRotation < 0.001, 'ambient secondary drift settles')
  assert.ok(
    blinkStarts >= 1 && blinkStarts <= 3,
    'rest keeps sparse slow blinks',
  )
})

test('deep rest keeps blinking across long quiet spans without an unbounded gap', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 4, boredom: 20 })
  runtime.setIdleBehaviorMode('rest')

  const blinkStarts: number[] = []
  let previousClosure = 0
  for (let now = 0; now <= 150_000; now += 25) {
    runtime.applyInto(pose(), now, 'idle')
    const closure = runtime.debugSignals().blinkClosure
    if (now >= 10_000 && closure > 0.35 && previousClosure <= 0.35) {
      blinkStarts.push(now)
    }
    previousClosure = closure
  }

  assert.ok(blinkStarts.length >= 6, 'deep rest never disables the lid clock')
  for (let index = 1; index < blinkStarts.length; index += 1) {
    assert.ok(
      blinkStarts[index] - blinkStarts[index - 1] < 24_000,
      'breath separation plus the finite rest interval stays bounded',
    )
  }
})

test('collapsed 10 FPS deep rest still observes sparse finite blink intervals', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 4, boredom: 20 })
  runtime.setIdleBehaviorMode('rest')
  runtime.setExpanded(false)

  const blinkStarts: number[] = []
  let previousClosure = 0
  for (let now = 0; now <= 150_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
    const closure = runtime.debugSignals().blinkClosure
    if (now >= 10_000 && closure > 0.2 && previousClosure <= 0.2) {
      blinkStarts.push(now)
    }
    previousClosure = closure
  }

  assert.ok(
    blinkStarts.length >= 6,
    'low-cadence rest continues to paint isolated lid beats',
  )
  for (let index = 1; index < blinkStarts.length; index += 1) {
    assert.ok(blinkStarts[index] - blinkStarts[index - 1] < 24_000)
  }
})

test('waking from an overdue rest clock schedules one natural first blink', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 4, boredom: 20 })
  runtime.setIdleBehaviorMode('rest')
  for (let now = 0; now <= 40_000; now += 25) {
    runtime.applyInto(pose(), now, 'idle')
  }

  // Model a long main-thread stall while expanded. The rest deadline is now
  // far behind wall time, but wake must not replay those missed blink slots.
  const wokeAt = 100_000
  assert.equal(runtime.requestWake(wokeAt), true)
  const blinkStarts: number[] = []
  let previousClosure = runtime.debugSignals().blinkClosure
  for (let now = wokeAt + 16; now <= wokeAt + 6_000; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
    const closure = runtime.debugSignals().blinkClosure
    if (closure > 0.35 && previousClosure <= 0.35) blinkStarts.push(now)
    previousClosure = closure
  }

  assert.ok(blinkStarts.length >= 1, 'wake retains a readable first blink')
  assert.ok(
    blinkStarts[0] - wokeAt >= 1_500,
    'the first wake blink does not arrive as rest-clock catch-up',
  )
  assert.ok(
    blinkStarts.length <= 2,
    'only one natural blink group lands in the first awake window',
  )
})

test('low-energy head follows a changed body pose with visible inertial delay', () => {
  const tired = new MotionRuntime(manifest)
  const alert = new MotionRuntime(manifest)
  tired.setCharacterState({ ...state, energy: 5 })
  alert.setCharacterState({ ...state, energy: 95 })
  tired.applyInto(pose(), 0, 'idle')
  alert.applyInto(pose(), 0, 'idle')

  const tiredMoved = pose()
  const alertMoved = pose()
  for (const output of [tiredMoved, alertMoved]) {
    output[1].translation.x = 0.04
    output[1].translation.y = 0.02
    output[1].rotation = 0.08
  }
  tired.applyInto(tiredMoved, 100, 'idle')
  alert.applyInto(alertMoved, 100, 'idle')

  assert.ok(tiredMoved[2].translation.x < alertMoved[2].translation.x - 0.01)
  assert.ok(tiredMoved[2].rotation < alertMoved[2].rotation - 0.02)
})

test('procedural posture blends continuously between idle and lighter activity', () => {
  const transitioning = new MotionRuntime(manifest)
  const idle = new MotionRuntime(manifest)
  const thinking = new MotionRuntime(manifest)
  for (const runtime of [transitioning, idle, thinking]) {
    runtime.setCharacterState({ ...state, energy: 8 })
  }
  transitioning.applyInto(pose(), 0, 'idle')
  idle.applyInto(pose(), 0, 'idle')
  thinking.applyInto(pose(), 0, 'thinking')
  transitioning.applyInto(pose(), 100, 'idle')
  idle.applyInto(pose(), 100, 'idle')
  thinking.applyInto(pose(), 100, 'thinking')

  const early = pose()
  const idleAtHandoff = pose()
  const thinkingAtHandoff = pose()
  transitioning.applyInto(early, 116, 'thinking')
  idle.applyInto(idleAtHandoff, 116, 'idle')
  thinking.applyInto(thinkingAtHandoff, 116, 'thinking')
  const earlyToIdle = Math.abs(
    early[1].translation.y - idleAtHandoff[1].translation.y,
  )
  const earlyToThinking = Math.abs(
    early[1].translation.y - thinkingAtHandoff[1].translation.y,
  )

  let settled = early
  let steadyThinking = thinkingAtHandoff
  for (let now = 132; now <= 1_100; now += 16) {
    settled = pose()
    steadyThinking = pose()
    transitioning.applyInto(settled, now, 'thinking')
    thinking.applyInto(steadyThinking, now, 'thinking')
  }

  assert.ok(earlyToIdle < earlyToThinking, 'the first frame stays near idle')
  assert.ok(
    Math.abs(settled[1].translation.y - steadyThinking[1].translation.y) <
      earlyToThinking * 0.2,
    'the posture converges to the lighter activity without a cut',
  )
})

test('talking drives the mouth while preserving safe transform bounds', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState(state)
  const output = pose()
  runtime.applyInto(output, 0, 'talking')
  runtime.applyInto(output, 120, 'talking')
  assert.notEqual(output[5].scale.y, 1)
  assert.ok(output.every((transform) => Number.isFinite(transform.rotation)))
  assert.ok(output.every((transform) => transform.scale.y >= 0.05))
})

test('speech lowers breath amplitude and restores it continuously within 400ms', () => {
  let scale = 1
  for (let elapsed = 0; elapsed < 500; elapsed += 16) {
    scale = speechBreathAmplitudeScale(scale, true, 0.016)
  }
  assert.ok(scale < 0.43, 'sustained speech keeps breathing visibly restrained')

  const released = scale
  for (let elapsed = 0; elapsed < SPEECH_BREATH_RECOVERY_MS; elapsed += 16) {
    scale = speechBreathAmplitudeScale(scale, false, 0.016)
  }
  assert.ok(scale > released)
  assert.ok(
    scale >= 0.994,
    'idle energy breath is effectively restored by 400ms',
  )
  assert.ok(scale <= 1, 'the recovery envelope cannot overshoot')
  assert.ok(
    speechBreathAmplitudeScale(released, false, 0.4) >= 0.994,
    'a missed collapsed frame uses wall time instead of stretching recovery',
  )

  const atMouthClose = speechBreathReleaseScale(released, SPEECH_MOUTH_CLOSE_MS)
  assert.ok(atMouthClose > released)
  assert.ok(
    atMouthClose < 0.62,
    'the chest stays restrained when the mouth has just reached rest',
  )
  assert.equal(speechBreathReleaseScale(released, SPEECH_BREATH_RECOVERY_MS), 1)
})

test('rest and speech share one chest amplitude envelope instead of multiplying', () => {
  assert.equal(chestBreathAmplitudeScale(1, 0), 1)
  assert.ok(Math.abs(chestBreathAmplitudeScale(1, 1) - 0.34) < 1e-12)
  assert.equal(chestBreathAmplitudeScale(0.42, 0), 0.42)
  assert.ok(
    Math.abs(chestBreathAmplitudeScale(0.42, 1) - 0.34) < 1e-12,
    'simultaneous rest and speech do not create a 0.1428 double scale',
  )

  const simultaneousWake = [
    chestBreathAmplitudeScale(0.42, 1),
    chestBreathAmplitudeScale(0.5, 0.8),
    chestBreathAmplitudeScale(0.62, 0.6),
    chestBreathAmplitudeScale(0.78, 0.35),
    chestBreathAmplitudeScale(1, 0),
  ]
  assert.ok(
    simultaneousWake.every(
      (value, index) => index === 0 || value >= simultaneousWake[index - 1],
    ),
    'recovering breath and unloading stillness cannot create an amplitude dip',
  )
})

test('runtime breath recovery starts from the rendered speech scale without a mouth-close surge', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setSpeechArticulation({ energy: 0.8, viseme: 'open', amount: 0.9 }, 0)
  for (let now = 0; now <= 480; now += 16) {
    runtime.applyInto(pose(), now, 'talking')
  }
  const speakingScale = runtime.debugSignals().breathAmplitudeScale

  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    480,
  )
  runtime.applyInto(pose(), 480, 'idle')
  const releaseStart = runtime.debugSignals().breathAmplitudeScale
  runtime.applyInto(pose(), 480 + SPEECH_MOUTH_CLOSE_MS, 'idle')
  const mouthClosed = runtime.debugSignals().breathAmplitudeScale
  runtime.applyInto(pose(), 480 + SPEECH_BREATH_RECOVERY_MS, 'idle')

  assert.ok(Math.abs(releaseStart - speakingScale) < 1e-9)
  assert.ok(mouthClosed > releaseStart)
  assert.ok(mouthClosed < 0.62)
  assert.equal(runtime.debugSignals().breathAmplitudeScale, 1)
})

test('visemes produce distinct mouth silhouettes beyond amplitude-only motion', () => {
  const wide = new MotionRuntime(manifest)
  const round = new MotionRuntime(manifest)
  const widePose = pose()
  const roundPose = pose()
  wide.setSpeechArticulation({ energy: 0.8, viseme: 'wide', amount: 0.9 }, 0)
  round.setSpeechArticulation({ energy: 0.8, viseme: 'round', amount: 0.9 }, 0)
  wide.applyInto(widePose, 16, 'talking')
  round.applyInto(roundPose, 16, 'talking')
  assert.ok(widePose[5].scale.x > roundPose[5].scale.x)
  assert.notEqual(widePose[5].scale.y, roundPose[5].scale.y)
})

test('a finished viseme closes fully inside the 120-180ms release window', () => {
  assert.equal(SPEECH_MOUTH_CLOSE_MS, 150)
  assert.equal(speechMouthReleaseWeight(0), 1)
  assert.equal(speechMouthReleaseWeight(75), 0.5)
  assert.equal(speechMouthReleaseWeight(150), 0)

  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState(state)
  runtime.setSpeechArticulation({ energy: 0.8, viseme: 'open', amount: 0.9 }, 0)
  runtime.applyInto(pose(), 100, 'talking')
  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    100,
  )
  const started = pose()
  const halfway = pose()
  const closed = pose()
  runtime.applyInto(started, 100, 'idle')
  runtime.applyInto(halfway, 175, 'idle')
  runtime.applyInto(closed, 250, 'idle')

  assert.ok(started[5].scale.y > halfway[5].scale.y)
  assert.ok(halfway[5].scale.y > closed[5].scale.y)
  assert.equal(closed[5].scale.x, 1)
  assert.equal(closed[5].scale.y, 1)
  assert.equal(closed[5].rotation, 0)
})

test('collapsed one-shot ownership cannot strand a releasing viseme half-open', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState(state)
  runtime.setSpeechArticulation({ energy: 0.8, viseme: 'open', amount: 0.9 }, 0)
  const speaking = pose()
  runtime.applyInto(speaking, 100, 'talking')
  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    100,
  )
  runtime.setExpanded(false, 110)

  const collapseFaceMask = manifest.bones.map((_, index) => index === 5)
  const firstCollapsedSlot = pose()
  firstCollapsedSlot[5] = {
    translation: { ...speaking[5].translation },
    rotation: speaking[5].rotation,
    scale: { ...speaking[5].scale },
  }
  runtime.applyInto(firstCollapsedSlot, 200, 'idle', collapseFaceMask)
  assert.ok(firstCollapsedSlot[5].scale.y < speaking[5].scale.y)
  assert.ok(firstCollapsedSlot[5].scale.y > 1)

  const closedSlot = pose()
  closedSlot[5] = {
    translation: { ...firstCollapsedSlot[5].translation },
    rotation: firstCollapsedSlot[5].rotation,
    scale: { ...firstCollapsedSlot[5].scale },
  }
  runtime.applyInto(closedSlot, 300, 'idle', collapseFaceMask)
  assert.deepEqual(closedSlot[5], pose()[5])
})

test('viseme recovery keeps the eyes open and owns the mouth until closure', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState(state)
  for (let now = 0; now <= 8_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
  }
  runtime.setSpeechArticulation(
    { energy: 0.8, viseme: 'narrow', amount: 0.85 },
    8_000,
  )
  runtime.applyInto(pose(), 8_100, 'talking')
  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    8_100,
  )

  let recoveryMouthRotation = 0
  for (let now = 8_100; now < 8_250; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    assert.equal(output[3].scale.y, 1, `left eye stays open at ${now}ms`)
    assert.equal(output[4].scale.y, 1, `right eye stays open at ${now}ms`)
    if (now === 8_170) recoveryMouthRotation = output[5].rotation
  }

  assert.ok(
    Math.abs(
      recoveryMouthRotation - -0.012 * 0.85 * speechMouthReleaseWeight(70),
    ) < 0.000001,
    'mouth recovery contains no idle micro-expression offset',
  )

  let minimumPostRecoveryEyeScale = 1
  for (let now = 8_250; now <= 8_500; now += 10) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    minimumPostRecoveryEyeScale = Math.min(
      minimumPostRecoveryEyeScale,
      output[3].scale.y,
    )
  }
  assert.ok(
    minimumPostRecoveryEyeScale < 0.6,
    'the deferred blink may begin after mouth closure',
  )
})

test('idle micro-expressions move brow and mouth slowly within a tiny envelope', () => {
  const expressiveManifest = {
    ...manifest,
    bones: [
      ...manifest.bones,
      { id: 'left-brow', parent: 'head' },
      { id: 'right-brow', parent: 'head' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(expressiveManifest)
  runtime.setCharacterState({ ...state, mood: 62 })
  const samples: Array<{ brow: number; mouth: number }> = []
  for (let now = 0; now <= 24_000; now += 200) {
    const output = expressiveManifest.bones.map(() => pose()[0])
    runtime.applyInto(output, now, 'idle')
    if (now >= 4_000 && now % 2_000 === 0) {
      samples.push({
        brow: output[8].rotation,
        mouth: output[5].scale.x - 1,
      })
    }
  }
  assert.ok(samples.some((sample) => Math.abs(sample.brow) > 0.0001))
  assert.ok(samples.some((sample) => Math.abs(sample.mouth) > 0.0005))
  assert.ok(samples.every((sample) => Math.abs(sample.brow) < 0.002))
  assert.ok(samples.every((sample) => Math.abs(sample.mouth) < 0.007))
})

test('idle glances soften the mouth micro-expression without flattening the brows', () => {
  const expressiveManifest = {
    ...manifest,
    bones: [
      ...manifest.bones,
      { id: 'left-brow', parent: 'head' },
      { id: 'right-brow', parent: 'head' },
    ],
  } as CompanionRigManifest
  const coordinated = new MotionRuntime(expressiveManifest)
  const reference = new MotionRuntime(expressiveManifest)
  for (const runtime of [coordinated, reference]) {
    runtime.setCharacterState({ ...state, energy: 76, mood: 78 })
  }
  reference.setGazeTarget({ x: 0, y: 0, attention: 0.4, source: 'camera' }, 0)

  let glanceStartedAt = -1
  let glanceEndedAt = -1
  let wasActive = false
  const mouthRatios: number[] = []
  const browDeltas: number[] = []
  const recoveryRatios: number[] = []
  for (let now = 0; now <= 12_000; now += 16) {
    const coordinatedPose = expressiveManifest.bones.map(() => pose()[0])
    const referencePose = expressiveManifest.bones.map(() => pose()[0])
    coordinated.applyInto(coordinatedPose, now, 'idle')
    reference.applyInto(referencePose, now, 'idle')
    const active =
      Math.abs(coordinated.debugSignals().idleGlance.x) > 0.0001 ||
      Math.abs(coordinated.debugSignals().idleGlance.y) > 0.0001
    if (active && !wasActive && glanceStartedAt < 0) glanceStartedAt = now
    if (!active && wasActive && glanceEndedAt < 0) glanceEndedAt = now

    const coordinatedMouth = coordinatedPose[5].scale.x - 1
    const referenceMouth = referencePose[5].scale.x - 1
    if (Math.abs(referenceMouth) > 0.0001) {
      if (active && glanceEndedAt < 0 && now >= glanceStartedAt + 180) {
        mouthRatios.push(Math.abs(coordinatedMouth) / Math.abs(referenceMouth))
        browDeltas.push(
          Math.abs(coordinatedPose[8].rotation - referencePose[8].rotation),
        )
      } else if (
        glanceEndedAt >= 0 &&
        now >= glanceEndedAt + 800 &&
        now <= glanceEndedAt + 1_600
      ) {
        recoveryRatios.push(
          Math.abs(coordinatedMouth) / Math.abs(referenceMouth),
        )
      }
    }
    wasActive = active
  }

  assert.ok(glanceStartedAt >= 3_000)
  assert.ok(glanceEndedAt > glanceStartedAt)
  assert.ok(mouthRatios.length > 8)
  assert.ok(
    Math.max(...mouthRatios) < 0.24,
    'the sideways glance cannot carry a full smile-shaped mouth offset',
  )
  assert.ok(
    browDeltas.every((delta) => delta < 0.0000001),
    'brow micro-expression remains available to carry attention',
  )
  assert.ok(recoveryRatios.length > 8)
  assert.ok(recoveryRatios.at(-1)! > 0.97)
})

test('collapsed presentation keeps eye gaze, breath, blink, and secondary motion but gates facial accents', () => {
  const expressiveManifest = {
    ...manifest,
    bones: [
      ...manifest.bones,
      { id: 'left-brow', parent: 'head' },
      { id: 'right-brow', parent: 'head' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(expressiveManifest)
  runtime.setCharacterState({ ...state, energy: 72, mood: 76 })
  runtime.setGazeTarget({ x: 1, y: -0.35, attention: 1, source: 'camera' }, 0)
  for (let now = 0; now <= 4_000; now += 16) {
    runtime.applyInto(
      expressiveManifest.bones.map(() => pose()[0]),
      now,
      'idle',
    )
  }

  runtime.setExpanded(false)
  const collapsed = expressiveManifest.bones.map(() => pose()[0])
  runtime.applyInto(collapsed, 4_016, 'idle')
  assert.ok(collapsed[3].translation.x > 0)
  assert.ok(collapsed[4].translation.x > 0)
  assert.equal(collapsed[5].translation.y, 0)
  assert.equal(collapsed[5].rotation, 0)
  assert.equal(collapsed[8].rotation, 0)
  assert.equal(collapsed[9].rotation, 0)
  assert.notEqual(collapsed[1].translation.y, 0, 'breath remains live')
  assert.notEqual(collapsed[6].rotation, 0, 'secondary motion remains live')

  runtime.setExpanded(true)
  runtime.setGazeTarget(
    { x: 0.8, y: -0.2, attention: 1, source: 'pointer' },
    4_016,
  )
  const firstExpanded = expressiveManifest.bones.map(() => pose()[0])
  runtime.applyInto(firstExpanded, 4_032, 'idle')
  assert.ok(
    firstExpanded[3].translation.x > 0,
    'pointer gaze is eligible again on the first expanded frame',
  )
})

test('the first expanded second continues collapsed breath and hair phase', () => {
  const continued = new MotionRuntime(manifest)
  const collapsedReference = new MotionRuntime(manifest)
  const fresh = new MotionRuntime(manifest)
  for (const runtime of [continued, collapsedReference, fresh]) {
    runtime.setCharacterState({ ...state, energy: 72 })
  }

  for (let now = 0; now <= 2_000; now += 20) {
    continued.applyInto(pose(), now, 'idle')
    collapsedReference.applyInto(pose(), now, 'idle')
  }
  continued.setExpanded(false)
  collapsedReference.setExpanded(false)
  for (let now = 2_100; now <= 6_000; now += 100) {
    continued.applyInto(pose(), now, 'idle')
    collapsedReference.applyInto(pose(), now, 'idle')
  }

  continued.setExpanded(true)
  const firstExpanded = pose()
  const stillCollapsed = pose()
  const restarted = pose()
  continued.applyInto(firstExpanded, 6_016, 'idle')
  collapsedReference.applyInto(stillCollapsed, 6_016, 'idle')
  fresh.applyInto(restarted, 6_016, 'idle')

  assert.ok(
    Math.abs(firstExpanded[1].translation.y - stillCollapsed[1].translation.y) <
      0.000001,
    'breath keeps the same wall-clock phase across expansion',
  )
  assert.ok(
    Math.abs(firstExpanded[1].translation.y - restarted[1].translation.y) >
      0.00001,
    'expansion does not restart the oscillator at its seeded first phase',
  )
  assert.ok(
    Math.abs(firstExpanded[6].rotation - stillCollapsed[6].rotation) < 0.01,
    'the first visible hair frame inherits the collapsed spring state',
  )
  assert.ok(
    Math.abs(firstExpanded[6].rotation) >
      Math.abs(restarted[6].rotation) + 0.000001,
  )

  let previousBodyY = firstExpanded[1].translation.y
  let previousHairRotation = firstExpanded[6].rotation
  for (let now = 6_032; now <= 7_016; now += 16) {
    const output = pose()
    continued.applyInto(output, now, 'idle')
    assert.ok(Math.abs(output[1].translation.y - previousBodyY) < 0.002)
    assert.ok(Math.abs(output[6].rotation - previousHairRotation) < 0.04)
    previousBodyY = output[1].translation.y
    previousHairRotation = output[6].rotation
  }
})

test('expanding during a collapsed blink preserves breath and lid phase without catch-up', () => {
  const expanded = new MotionRuntime(manifest)
  const collapsed = new MotionRuntime(manifest)
  for (const runtime of [expanded, collapsed]) {
    runtime.setCharacterState({ ...state, energy: 72 })
    runtime.setExpanded(false, 0)
  }

  let blinkAt = -1
  let retainedPose = pose()
  for (let now = 0; now <= 20_000; now += 100) {
    const candidate = pose()
    expanded.applyInto(candidate, now, 'idle')
    collapsed.applyInto(pose(), now, 'idle')
    if (expanded.debugSignals().blinkClosure > 0.35) {
      blinkAt = now
      retainedPose = candidate
      break
    }
  }
  assert.ok(blinkAt > 0, 'the deterministic sample reaches a collapsed blink')

  const retainedClosure = expanded.debugSignals().blinkClosure
  const retainedBreathPhase = expanded.debugSignals().breathPhase
  expanded.setExpanded(true, blinkAt)
  const firstExpanded = pose()
  expanded.applyInto(firstExpanded, blinkAt, 'idle')
  assert.equal(expanded.debugSignals().blinkClosure, retainedClosure)
  assert.equal(expanded.debugSignals().breathPhase, retainedBreathPhase)
  assert.equal(firstExpanded[3].scale.y, retainedPose[3].scale.y)

  for (let offset = 16; offset <= 96; offset += 16) {
    const densePose = pose()
    expanded.applyInto(densePose, blinkAt + offset, 'idle')
    if (offset === 96) {
      const lowCadencePose = pose()
      collapsed.applyInto(lowCadencePose, blinkAt + offset, 'idle')
      assert.ok(
        Math.abs(
          expanded.debugSignals().breathPhase -
            collapsed.debugSignals().breathPhase,
        ) < 0.0000001,
      )
      assert.ok(
        Math.abs(
          expanded.debugSignals().blinkClosure -
            collapsed.debugSignals().blinkClosure,
        ) < 0.0000001,
        '60 FPS subdivision consumes the same lid phase as one collapsed interval',
      )
      assert.ok(
        Math.abs(densePose[3].scale.y - lowCadencePose[3].scale.y) < 0.0000001,
      )
    }
  }
})

test('a precise collapsed blink peak hands its exact lid phase to 60 FPS expansion', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 2.2,
    maxIntervalSeconds: 2.2,
    doubleChance: 0,
  }
  const runtime = new MotionRuntime(manifest, profile)
  runtime.setExpanded(false, 0)

  let peakAt = -1
  for (let now = 0; now <= 12_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
    const delay = runtime.nextBlinkPeakDelayMs(now, 100)
    if (delay === null) continue
    peakAt = now + delay
    break
  }
  assert.ok(peakAt > 0 && peakAt % 100 !== 0, 'the peak uses its exact timer')

  runtime.setExpanded(true, peakAt)
  const peakPose = pose()
  runtime.applyInto(peakPose, peakAt, 'idle')
  assert.ok(runtime.debugSignals().blinkClosure > 0.999)
  assert.ok(peakPose[3].scale.y < 0.061)

  const closures: number[] = []
  for (let now = peakAt + 16; now <= peakAt + 400; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
    closures.push(runtime.debugSignals().blinkClosure)
  }
  assert.ok(
    closures.every(
      (closure, index) => index === 0 || closure <= closures[index - 1],
    ),
    'rAF continues reopening the same blink instead of starting it again',
  )
  assert.equal(closures.at(-1), 0)
})

test('the second half of a double blink rechecks the breath valley across collapse expansion', () => {
  const profile = createDefaultMotionProfile(manifest)
  profile.blink = {
    ...profile.blink,
    minIntervalSeconds: 2.2,
    maxIntervalSeconds: 2.2,
    doubleChance: 1,
  }
  const runtime = new MotionRuntime(manifest, profile)
  runtime.setCharacterState({ ...state, energy: 92 })
  runtime.setExpanded(false, 0)

  let expandedAt = -1
  let previousClosure = 0
  for (let now = 0; now <= 12_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
    const closure = runtime.debugSignals().blinkClosure
    if (closure > 0.45 && previousClosure <= 0.45) {
      expandedAt = now
      runtime.setCharacterState({ ...state, energy: 8 })
      runtime.setExpanded(true, now)
      break
    }
    previousClosure = closure
  }
  assert.ok(expandedAt > 0, 'the collapsed cadence reaches the first closure')

  const closurePeaks: Array<{ at: number; breath: number }> = []
  let previous = runtime.debugSignals().blinkClosure
  let previousBreath = runtime.signals(expandedAt, 'idle').breath
  let rising = true
  for (let now = expandedAt + 5; now <= expandedAt + 5_000; now += 5) {
    runtime.applyInto(pose(), now, 'idle')
    const closure = runtime.debugSignals().blinkClosure
    const breath = runtime.signals(now, 'idle').breath
    if (rising && closure < previous && previous > 0.35) {
      closurePeaks.push({ at: now - 5, breath: previousBreath })
      rising = false
    } else if (!rising && closure > previous) {
      rising = true
    }
    previous = closure
    previousBreath = breath
  }

  assert.ok(
    closurePeaks.length >= 2,
    'both closures survive the cadence boundary',
  )
  assert.ok(
    closurePeaks[1].at > expandedAt,
    'the second closure lands after expansion',
  )
  assert.ok(
    closurePeaks[1].breath > -0.55,
    'the second closure is revalidated against the live breath phase',
  )
  assert.ok(closurePeaks.length >= 3, 'a later ambient group still schedules')
  assert.ok(
    closurePeaks[2].at - closurePeaks[1].at >= 600,
    'the next ambient group cannot interleave with the retained second closure',
  )
})

test('expansion after ten collapsed minutes preserves oscillator and spring phase', () => {
  const continued = new MotionRuntime(manifest)
  const collapsedReference = new MotionRuntime(manifest)
  for (const runtime of [continued, collapsedReference]) {
    runtime.setCharacterState({ ...state, energy: 72 })
    runtime.setExpanded(false)
  }

  let retainedHair = 0
  for (let now = 0; now <= 610_000; now += 100) {
    const continuedPose = pose()
    continued.applyInto(continuedPose, now, 'idle')
    collapsedReference.applyInto(pose(), now, 'idle')
    retainedHair = continuedPose[6].rotation
  }

  continued.setExpanded(true)
  continued.prepareExpansion(610_000)
  const firstExpanded = pose()
  const stillCollapsed = pose()
  continued.applyInto(firstExpanded, 610_016, 'idle')
  collapsedReference.applyInto(stillCollapsed, 610_016, 'idle')

  assert.ok(
    Math.abs(firstExpanded[1].translation.y - stillCollapsed[1].translation.y) <
      0.000001,
    'breath phase continues from the collapsed clock after more than ten minutes',
  )
  assert.ok(
    Math.abs(firstExpanded[6].rotation - retainedHair) < 0.04,
    'the first expanded spring pose cannot kick away from the retained pose',
  )
  assert.ok(
    Math.abs(firstExpanded[6].rotation - stillCollapsed[6].rotation) < 0.01,
    'hair inherits the same accumulated collapsed spring phase',
  )
})

test('expansion immediately after a minute-long hidden collapsed gap consumes one 100ms slot', () => {
  const shortGap = new MotionRuntime(manifest)
  const hiddenGap = new MotionRuntime(manifest)
  for (const runtime of [shortGap, hiddenGap]) {
    runtime.setCharacterState({ ...state, energy: 72 })
    runtime.setExpanded(false)
    for (let now = 0; now <= 1_000; now += 100) {
      runtime.applyInto(pose(), now, 'thinking')
    }
  }

  shortGap.setExpanded(true, 1_100)
  hiddenGap.setExpanded(true, 61_100)
  hiddenGap.applyInto(pose(), 900, 'thinking')
  const expected = pose()
  const actual = pose()
  shortGap.applyInto(expected, 1_100, 'thinking')
  hiddenGap.applyInto(actual, 61_100, 'thinking')

  assert.ok(
    Math.abs(
      hiddenGap.debugSignals().breathPhase -
        shortGap.debugSignals().breathPhase,
    ) < 1e-12,
    'a stale collapsed callback cannot consume the pending cadence slot',
  )
  assert.ok(
    Math.abs(actual[6].rotation - expected[6].rotation) < 1e-12,
    'the hidden interval cannot rebase or fast-forward the hair spring',
  )
})

test('repeated hidden collapsed expansions stay on the compressed continuity clock', () => {
  const compressed = new MotionRuntime(manifest)
  const hidden = new MotionRuntime(manifest)
  for (const runtime of [compressed, hidden]) {
    runtime.setCharacterState({ ...state, energy: 72 })
    runtime.applyInto(pose(), 0, 'thinking')
  }

  let compressedNow = 0
  let hiddenNow = 0
  for (let cycle = 0; cycle < 64; cycle += 1) {
    compressed.setExpanded(false, compressedNow)
    hidden.setExpanded(false, hiddenNow)
    compressedNow += 100
    hiddenNow += 60_000 + cycle * 137
    compressed.setExpanded(true, compressedNow)
    hidden.setExpanded(true, hiddenNow)

    for (let frame = 0; frame < 9; frame += 1) {
      const expected = pose()
      const actual = pose()
      compressed.applyInto(expected, compressedNow, 'thinking')
      hidden.applyInto(actual, hiddenNow, 'thinking')
      assert.ok(
        Math.abs(
          hidden.debugSignals().breathPhase -
            compressed.debugSignals().breathPhase,
        ) < 1e-10,
        `cycle ${cycle} frame ${frame} keeps the compressed breath clock`,
      )
      assert.ok(
        Math.abs(
          hidden.debugSignals().blinkClosure -
            compressed.debugSignals().blinkClosure,
        ) < 1e-10,
        `cycle ${cycle} frame ${frame} keeps the compressed lid clock`,
      )
      assert.ok(
        Math.abs(actual[6].rotation - expected[6].rotation) < 1e-10,
        `cycle ${cycle} frame ${frame} retains the secondary spring baseline`,
      )
      compressedNow += 16
      hiddenNow += 16
    }
  }
})

test('active visemes fully own the mouth over changing idle expression phases', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState(state)
  for (let now = 0; now <= 6_000; now += 100) {
    runtime.applyInto(pose(), now, 'idle')
  }
  const mouthShapes: Array<[number, number, number]> = []
  for (const now of [6_000, 8_000, 11_000]) {
    runtime.setSpeechArticulation(
      { energy: 0.7, viseme: 'wide', amount: 0.85 },
      now,
    )
    const output = pose()
    runtime.applyInto(output, now, 'talking')
    mouthShapes.push([output[5].scale.x, output[5].scale.y, output[5].rotation])
  }
  assert.deepEqual(mouthShapes[1], mouthShapes[0])
  assert.deepEqual(mouthShapes[2], mouthShapes[0])
})

test('speech suppresses idle blink noise and adds one natural blink after release', () => {
  const speaking = new MotionRuntime(manifest)
  const idle = new MotionRuntime(manifest)
  const speakingBlinkStarts: number[] = []
  const idleBlinkStarts: number[] = []
  let speakingWasClosed = false
  let idleWasClosed = false

  speaking.setSpeechArticulation(
    { energy: 0.72, viseme: 'wide', amount: 0.84 },
    0,
  )
  for (let now = 0; now <= 18_000; now += 16) {
    speaking.setSpeechArticulation(
      {
        energy: 0.58 + Math.sin(now / 170) * 0.18,
        viseme: now % 320 < 160 ? 'wide' : 'round',
        amount: 0.78,
      },
      now,
    )
    const speakingPose = pose()
    const idlePose = pose()
    speaking.applyInto(speakingPose, now, 'talking')
    idle.applyInto(idlePose, now, 'idle')
    const speakingClosed = speakingPose[3].scale.y < 0.6
    const idleClosed = idlePose[3].scale.y < 0.6
    if (speakingClosed && !speakingWasClosed) speakingBlinkStarts.push(now)
    if (idleClosed && !idleWasClosed) idleBlinkStarts.push(now)
    speakingWasClosed = speakingClosed
    idleWasClosed = idleClosed
  }

  assert.ok(
    speakingBlinkStarts.length < idleBlinkStarts.length,
    'talking uses fewer phrase-level blinks than idle',
  )

  speaking.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    18_000,
  )
  let postSpeechClosures = 0
  let wasClosed = false
  for (let now = 18_000; now <= 19_000; now += 16) {
    const output = pose()
    speaking.applyInto(output, now, 'idle')
    const closed = output[3].scale.y < 0.6
    if (closed && !wasClosed) postSpeechClosures += 1
    wasClosed = closed
  }
  assert.equal(postSpeechClosures, 1)
})

test('speech blinks and the first post-speech blink keep their peaks out of the breathing trough', () => {
  const runtime = new MotionRuntime(manifest)
  const speechClosureBreaths: number[] = []
  let previousClosure = 0
  let previousBreath = 0

  runtime.setSpeechArticulation(
    { energy: 0.72, viseme: 'wide', amount: 0.84 },
    0,
  )
  for (let now = 0; now <= 24_000; now += 5) {
    runtime.setSpeechArticulation(
      {
        energy: 0.62 + Math.sin(now / 190) * 0.14,
        viseme: now % 360 < 180 ? 'wide' : 'round',
        amount: 0.8,
      },
      now,
    )
    runtime.applyInto(pose(), now, 'talking')
    const closure = runtime.debugSignals().blinkClosure
    const breath = runtime.signals(now, 'talking').breath
    if (previousClosure >= 0.99 && closure < previousClosure) {
      speechClosureBreaths.push(previousBreath)
    }
    previousClosure = closure
    previousBreath = breath
  }

  assert.ok(
    speechClosureBreaths.length >= 2,
    'the sample crosses multiple phrase-level speech blinks',
  )
  assert.ok(
    speechClosureBreaths.every((breath) => breath > -0.55 - Number.EPSILON * 8),
    'speech blink peaks remain outside the exhale trough',
  )

  // Release on the deepest available exhale sample so the first deliberate
  // post-speech blink must exercise the same valley-separation policy.
  let releasedAt = 24_000
  for (let now = 24_005; now <= 30_000; now += 5) {
    runtime.setSpeechArticulation(
      { energy: 0.68, viseme: 'open', amount: 0.76 },
      now,
    )
    runtime.applyInto(pose(), now, 'talking')
    if (runtime.signals(now, 'talking').breath < -0.99) {
      releasedAt = now
      break
    }
  }
  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    releasedAt,
  )

  previousClosure = runtime.debugSignals().blinkClosure
  previousBreath = runtime.signals(releasedAt, 'idle').breath
  let firstPostSpeechClosureBreath: number | null = null
  for (let now = releasedAt + 5; now <= releasedAt + 3_000; now += 5) {
    runtime.applyInto(pose(), now, 'idle')
    const closure = runtime.debugSignals().blinkClosure
    const breath = runtime.signals(now, 'idle').breath
    if (previousClosure >= 0.99 && closure < previousClosure) {
      firstPostSpeechClosureBreath = previousBreath
      break
    }
    previousClosure = closure
    previousBreath = breath
  }

  assert.notEqual(firstPostSpeechClosureBreath, null)
  assert.ok(
    (firstPostSpeechClosureBreath ?? -1) > -0.55 - Number.EPSILON * 8,
    'the first blink after speech also remains outside the exhale trough',
  )
})

test('pointer and camera gaze yield to visemes then reconnect smoothly', () => {
  for (const source of ['pointer', 'camera'] as const) {
    const runtime = new MotionRuntime(manifest)
    const visemeOnly = new MotionRuntime(manifest)
    runtime.setGazeTarget({ x: 0.8, y: -0.25, attention: 1, source }, 0)

    let focused = pose()
    for (let now = 0; now <= 800; now += 16) {
      focused = pose()
      runtime.applyInto(focused, now, 'idle')
      visemeOnly.applyInto(pose(), now, 'idle')
    }

    const articulation = { energy: 0.75, viseme: 'wide' as const, amount: 0.9 }
    runtime.setSpeechArticulation(articulation, 800)
    visemeOnly.setSpeechArticulation(articulation, 800)
    let previousEyeX = focused[3].translation.x
    let maximumEyeStep = 0
    let speaking = focused
    let referenceMouth = pose()[5]
    for (let now = 816; now <= 1_280; now += 16) {
      speaking = pose()
      const reference = pose()
      runtime.applyInto(speaking, now, 'talking')
      visemeOnly.applyInto(reference, now, 'talking')
      maximumEyeStep = Math.max(
        maximumEyeStep,
        Math.abs(speaking[3].translation.x - previousEyeX),
      )
      previousEyeX = speaking[3].translation.x
      referenceMouth = reference[5]
    }

    assert.ok(
      speaking[3].translation.x < focused[3].translation.x * 0.62,
      `${source} gaze visibly yields while the viseme is live`,
    )
    assert.deepEqual(speaking[5], referenceMouth)
    assert.ok(maximumEyeStep < 0.001)

    runtime.setSpeechArticulation(
      { energy: null, viseme: 'rest', amount: 0 },
      1_280,
    )
    const closing = pose()
    runtime.applyInto(closing, 1_376, 'idle')
    assert.ok(
      closing[3].translation.x < focused[3].translation.x * 0.72,
      'gaze stays secondary while the mouth finishes closing',
    )

    let reconnected = closing
    for (let now = 1_392; now <= 2_240; now += 16) {
      reconnected = pose()
      runtime.applyInto(reconnected, now, 'idle')
    }
    assert.ok(reconnected[3].translation.x > focused[3].translation.x * 0.9)
  }
})

test('speech interruption clears a live idle glance before the first viseme frame', () => {
  const interrupted = new MotionRuntime(manifest)
  const ambientReference = new MotionRuntime(manifest)
  let interruptedAt = -1
  let glanceDirection = 0

  for (let now = 0; now <= 10_000; now += 16) {
    const interruptedPose = pose()
    interrupted.applyInto(interruptedPose, now, 'idle')
    ambientReference.applyInto(pose(), now, 'thinking')
    const glance = interrupted.signals(now, 'idle').idleGlanceX
    if (Math.abs(glance) > 0.18 && now > 8_000) {
      interruptedAt = now
      glanceDirection = Math.sign(glance)
      break
    }
  }

  assert.ok(interruptedAt > 0)
  const articulation = { energy: 0.8, viseme: 'wide' as const, amount: 0.9 }
  interrupted.setSpeechArticulation(articulation, interruptedAt)
  ambientReference.setSpeechArticulation(articulation, interruptedAt)

  const firstSpeechPose = pose()
  const referenceSpeechPose = pose()
  interrupted.applyInto(firstSpeechPose, interruptedAt + 16, 'talking')
  ambientReference.applyInto(referenceSpeechPose, interruptedAt + 16, 'talking')

  assert.equal(
    interrupted.signals(interruptedAt + 16, 'talking').idleGlanceX,
    0,
  )
  assert.ok(
    Math.abs(
      firstSpeechPose[3].translation.x - referenceSpeechPose[3].translation.x,
    ) < 0.00016,
    'the first syllable uses ambient gaze instead of completing the old sweep',
  )
  assert.ok(firstSpeechPose[5].scale.x > 1.1)
  assert.ok(firstSpeechPose[5].scale.y < 0.97)

  interrupted.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    interruptedAt + 640,
  )
  for (let now = interruptedAt + 656; now < interruptedAt + 3_640; now += 16) {
    assert.equal(interrupted.signals(now, 'idle').idleGlanceX, 0)
  }
  let resumedDirection = 0
  for (
    let now = interruptedAt + 3_640;
    now <= interruptedAt + 8_660;
    now += 16
  ) {
    const glance = interrupted.signals(now, 'idle').idleGlanceX
    if (Math.abs(glance) > 0.0001) {
      resumedDirection = Math.sign(glance)
      break
    }
  }
  assert.equal(
    resumedDirection,
    -glanceDirection,
    'post-speech idle starts a fresh interval on the opposite side',
  )
})

test('speech interrupted glance reconnects directly to newly arrived camera gaze', () => {
  const runtime = new MotionRuntime(manifest)
  let interruptedAt = -1
  let glanceDirection = 0
  for (let now = 0; now <= 10_000; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
    const glance = runtime.signals(now, 'idle').idleGlanceX
    if (Math.abs(glance) > 0.18 && now > 8_000) {
      interruptedAt = now
      glanceDirection = Math.sign(glance)
      break
    }
  }
  assert.ok(interruptedAt > 0)

  const cameraDirection = -glanceDirection
  runtime.setGazeTarget(
    {
      x: cameraDirection * 0.82,
      y: -0.18,
      attention: 1,
      source: 'camera',
    },
    interruptedAt,
  )
  runtime.setSpeechArticulation(
    { energy: 0.78, viseme: 'round', amount: 0.88 },
    interruptedAt,
  )
  for (let now = interruptedAt + 16; now <= interruptedAt + 640; now += 16) {
    runtime.applyInto(pose(), now, 'talking')
    assert.equal(runtime.debugSignals().gazeSource, 'camera')
    assert.deepEqual(runtime.debugSignals().idleGlance, { x: 0, y: 0 })
  }

  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    interruptedAt + 640,
  )
  let reconnected = pose()
  for (let now = interruptedAt + 656; now <= interruptedAt + 1_600; now += 16) {
    reconnected = pose()
    runtime.applyInto(reconnected, now, 'idle')
  }
  assert.equal(runtime.debugSignals().gazeSource, 'camera')
  assert.ok(
    reconnected[3].translation.x * cameraDirection > 0.003,
    'post-viseme gaze follows the camera side instead of reviving the old glance',
  )
})

test('gaze release during speech defers its covering blink until speech ends', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget({ x: 1, y: -0.2, attention: 1 })
  runtime.setSpeechArticulation({ energy: 0.8, viseme: 'open', amount: 0.9 }, 0)
  runtime.applyInto(pose(), 0, 'talking')
  runtime.releaseGazeWithBlink(100)

  let minimumSpeechEyeScale = 1
  for (let now = 100; now <= 600; now += 16) {
    runtime.setSpeechArticulation(
      { energy: 0.7, viseme: 'wide', amount: 0.85 },
      now,
    )
    const output = pose()
    runtime.applyInto(output, now, 'talking')
    minimumSpeechEyeScale = Math.min(minimumSpeechEyeScale, output[3].scale.y)
  }
  assert.ok(minimumSpeechEyeScale > 0.95)

  runtime.setSpeechArticulation(
    { energy: null, viseme: 'rest', amount: 0 },
    600,
  )
  runtime.releaseGazeWithBlink(650)
  let minimumReleasedEyeScale = 1
  let eyeScaleAfterPostSpeechBlink: number | null = null
  for (let now = 600; now <= 1_700; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    minimumReleasedEyeScale = Math.min(
      minimumReleasedEyeScale,
      output[3].scale.y,
    )
    if (now >= 1_640 && eyeScaleAfterPostSpeechBlink === null) {
      eyeScaleAfterPostSpeechBlink = output[3].scale.y
    }
  }
  assert.ok(minimumReleasedEyeScale < 0.35)
  assert.ok(
    (eyeScaleAfterPostSpeechBlink ?? 0) > 0.95,
    'gaze release reuses the queued post-speech blink instead of extending it',
  )
})

test('gaze follows explicit targets with a visible eye lead and subtle head follow', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget({ x: 1, y: -0.5, attention: 1 }, 0)
  const eyeFirst = pose()
  runtime.applyInto(eyeFirst, 32, 'idle')
  const eyesOnly = pose()
  runtime.applyInto(eyesOnly, 128, 'idle')
  const headLater = pose()
  runtime.applyInto(headLater, 192, 'idle')
  assert.ok(eyeFirst[3].translation.x > 0)
  assert.ok(eyeFirst[4].translation.y < 0)
  assert.ok(
    Math.abs(eyesOnly[2].rotation) < 0.001,
    'the shoulder-free eye beat remains readable before the head joins',
  )
  assert.ok(
    headLater[2].rotation > eyesOnly[2].rotation + 0.002,
    'the head joins after the eyes have acknowledged the target',
  )
})

test('camera attention leads with the eyes, barely recruits the head, and returns eyes first', () => {
  const layeredManifest = manifest
  const watched = new MotionRuntime(layeredManifest)
  watched.setGazeTarget({ x: 0.7, y: -0.16, attention: 1, source: 'camera' }, 0)

  const eyeLead = layeredManifest.bones.map(() => pose()[0])
  watched.applyInto(eyeLead, 96, 'idle')
  let focused = eyeLead
  for (let now = 112; now <= 640; now += 16) {
    focused = layeredManifest.bones.map(() => pose()[0])
    watched.applyInto(focused, now, 'idle')
  }

  assert.ok(eyeLead[3].translation.x > 0.002)
  assert.ok(Math.abs(eyeLead[2].rotation) < 0.001)
  assert.ok(focused[2].rotation > eyeLead[2].rotation + 0.002)
  assert.ok(
    focused[2].rotation < focused[3].translation.x * 3,
    'camera attention keeps the head response restrained beside the eyes',
  )
  watched.setGazeTarget(null, 640)
  const returning = layeredManifest.bones.map(() => pose()[0])
  watched.applyInto(returning, 752, 'idle')
  assert.ok(
    returning[3].translation.x / focused[3].translation.x <
      returning[2].rotation / focused[2].rotation,
    'the eyes start returning before the restrained head',
  )
})

test('pointer gaze overrides camera attention and hands back without a pose jump', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget(
    { x: -0.72, y: -0.12, attention: 1, source: 'camera' },
    0,
  )
  let cameraPose = pose()
  for (let now = 0; now <= 640; now += 16) {
    cameraPose = pose()
    runtime.applyInto(cameraPose, now, 'idle')
  }
  assert.ok(cameraPose[3].translation.x < -0.003)

  runtime.setGazeTarget(
    { x: 0.9, y: -0.28, attention: 1, source: 'pointer' },
    640,
  )
  let pointerPose = cameraPose
  for (let now = 656; now <= 1_120; now += 16) {
    pointerPose = pose()
    runtime.applyInto(pointerPose, now, 'idle')
  }
  assert.ok(pointerPose[3].translation.x > 0.004)
  assert.ok(pointerPose[2].rotation > 0.006)

  runtime.setGazeTarget(null, 1_120, 'pointer')
  const firstHandoff = pose()
  runtime.applyInto(firstHandoff, 1_136, 'idle')
  assert.ok(firstHandoff[3].translation.x > 0)
  assert.ok(
    Math.abs(firstHandoff[3].translation.x - pointerPose[3].translation.x) <
      0.002,
    'source arbitration changes the target without snapping the visible pose',
  )

  let returnedToCamera = firstHandoff
  for (let now = 1_152; now <= 1_920; now += 16) {
    returnedToCamera = pose()
    runtime.applyInto(returnedToCamera, now, 'idle')
  }
  assert.ok(returnedToCamera[3].translation.x < -0.003)
  assert.ok(returnedToCamera[2].rotation < -0.003)
})

test('rapid camera-pointer handoffs keep head yaw inside the shared source rate budget', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget({ x: -0.9, y: -0.1, attention: 1, source: 'camera' }, 0)
  let previousHeadYaw = 0
  for (let now = 0; now <= 640; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    previousHeadYaw = output[2].rotation
  }

  const headSteps: number[] = []
  let pointerActive = false
  let sourceHandoffs = 0
  for (let now = 656; now <= 2_576; now += 16) {
    const phase = (now - 656) % 192
    if (phase === 0) {
      pointerActive = true
      sourceHandoffs += 1
      runtime.setGazeTarget(
        { x: 0.95, y: -0.22, attention: 1, source: 'pointer' },
        now,
      )
    } else if (phase === 96) {
      pointerActive = false
      sourceHandoffs += 1
      runtime.setGazeTarget(null, now, 'pointer')
    }
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    headSteps.push(Math.abs(output[2].rotation - previousHeadYaw))
    previousHeadYaw = output[2].rotation
    assert.equal(
      runtime.debugSignals().gazeSource,
      pointerActive ? 'pointer' : 'camera',
    )
  }

  assert.ok(sourceHandoffs >= 18)
  assert.ok(
    Math.max(...headSteps) < 0.00135,
    'opposite source updates cannot whip the head faster than the handoff envelope',
  )
})

test('a large live retarget restarts the eye lead without dragging the shoulders', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget({ x: -1, y: 0, attention: 1 }, 0)
  let lookingLeft = pose()
  for (let now = 0; now <= 480; now += 16) {
    lookingLeft = pose()
    runtime.applyInto(lookingLeft, now, 'idle')
  }
  assert.ok(lookingLeft[3].translation.x < -0.004)
  assert.ok(lookingLeft[2].rotation < -0.008)

  runtime.setGazeTarget({ x: 1, y: 0, attention: 1 }, 480)
  const eyesCrossed = pose()
  runtime.applyInto(eyesCrossed, 592, 'idle')
  const headCrossed = pose()
  runtime.applyInto(headCrossed, 784, 'idle')

  assert.ok(eyesCrossed[3].translation.x > 0, 'eyes reach the new side first')
  assert.ok(
    eyesCrossed[2].rotation < 0,
    'head still holds the previous target during the renewed lead',
  )
  assert.ok(
    headCrossed[2].rotation > eyesCrossed[2].rotation + 0.006,
    'head follows only after the new target is established',
  )
})

test('continuous pointer updates do not postpone head follow until movement stops', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget({ x: 0.2, y: -0.1, attention: 1 }, 0)

  let whileMoving = pose()
  for (let now = 16; now <= 480; now += 16) {
    const progress = now / 480
    runtime.setGazeTarget(
      { x: 0.2 + progress * 0.72, y: -0.1, attention: 1 },
      now,
    )
    whileMoving = pose()
    runtime.applyInto(whileMoving, now, 'idle')
  }

  assert.ok(whileMoving[3].translation.x > 0.004)
  assert.ok(
    whileMoving[2].rotation > 0.006,
    'head follows the moving input after the initial eye lead',
  )
  assert.ok(
    whileMoving[3].translation.x / 0.0064 > whileMoving[2].rotation / 0.03,
    'eyes retain a visible lead while the target is still moving',
  )
})

test('a gaze release between 10 FPS frames preserves the complete eye-first return', () => {
  const released = new MotionRuntime(manifest)
  const held = new MotionRuntime(manifest)
  for (const runtime of [released, held]) {
    runtime.setGazeTarget({ x: 1, y: -0.2, attention: 1 }, 0)
  }

  let focused = pose()
  for (let now = 0; now <= 1_000; now += 100) {
    focused = pose()
    released.applyInto(focused, now, 'idle')
    held.applyInto(pose(), now, 'idle')
  }

  // Pointer leave lands halfway between two collapsed-cadence samples. The
  // release beat must begin at the input event, not at the previous frame.
  released.setGazeTarget(null, 1_050)
  const eyeLead = pose()
  released.applyInto(eyeLead, 1_200, 'idle')
  const stillHeld = pose()
  held.applyInto(stillHeld, 1_200, 'idle')

  assert.ok(
    Math.abs(eyeLead[3].translation.x) <
      Math.abs(stillHeld[3].translation.x) * 0.8,
    'eyes are already returning between low-cadence frames',
  )
  assert.ok(
    Math.abs(eyeLead[2].rotation - stillHeld[2].rotation) < 0.0008,
    'head still holds the acquired direction for the full release lead',
  )

  const headReturn = pose()
  released.applyInto(headReturn, 1_300, 'idle')
  held.applyInto(pose(), 1_300, 'idle')
  assert.ok(
    Math.abs(headReturn[2].rotation) < Math.abs(focused[2].rotation),
    'head joins only after the low-cadence eye lead has completed',
  )
})

test('collapsed camera gaze retains eye direction while expansion recruits the head', () => {
  const runtime = new MotionRuntime(manifest)
  const ambient = new MotionRuntime(manifest)
  runtime.setExpanded(false)
  ambient.setExpanded(false)
  runtime.setGazeTarget({ x: 1, y: -0.2, attention: 1, source: 'camera' }, 0)
  let collapsedEyeX = 0
  for (let now = 0; now <= 1_000; now += 100) {
    const hidden = pose()
    runtime.applyInto(hidden, now, 'idle')
    ambient.applyInto(pose(), now, 'idle')
    collapsedEyeX = hidden[3].translation.x
    assert.ok(hidden[3].translation.x >= 0)
    assert.equal(hidden[2].rotation, 0)
  }
  assert.ok(collapsedEyeX > 0.004, 'only the eyes acquire collapsed gaze')

  runtime.setExpanded(true)
  ambient.setExpanded(true)
  const first = pose()
  const firstAmbient = pose()
  runtime.applyInto(first, 1_016, 'idle')
  ambient.applyInto(firstAmbient, 1_016, 'idle')
  const headGazePath: number[] = [first[2].rotation - firstAmbient[2].rotation]
  let settled = first
  let settledAmbient = firstAmbient
  for (let now = 1_032; now <= 1_800; now += 16) {
    settled = pose()
    settledAmbient = pose()
    runtime.applyInto(settled, now, 'idle')
    ambient.applyInto(settledAmbient, now, 'idle')
    headGazePath.push(settled[2].rotation - settledAmbient[2].rotation)
  }

  assert.ok(first[3].translation.x >= collapsedEyeX * 0.98)
  assert.ok(headGazePath[0] < headGazePath.at(-1)! * 0.25)
  assert.ok(headGazePath.every((value) => value >= -1e-12))
})

test('collapsed 10 FPS gaze rejects stale pointer coordinates before expansion', () => {
  const targeted = new MotionRuntime(manifest)
  const ambient = new MotionRuntime(manifest)
  targeted.setGazeTarget({ x: 1, y: -0.2, attention: 1, source: 'pointer' }, 0)
  for (let now = 0; now <= 600; now += 20) {
    targeted.applyInto(pose(), now, 'idle')
    ambient.applyInto(pose(), now, 'idle')
  }
  targeted.setExpanded(false, 600)
  ambient.setExpanded(false, 600)
  for (let now = 700; now <= 1_600; now += 100) {
    targeted.setGazeTarget(
      { x: 1, y: -0.2, attention: 1, source: 'pointer' },
      now - 20,
    )
    targeted.applyInto(pose(), now, 'idle')
    ambient.applyInto(pose(), now, 'idle')
    assert.notEqual(targeted.debugSignals().gazeSource, 'pointer')
  }

  targeted.setExpanded(true, 1_600)
  ambient.setExpanded(true, 1_600)
  const first = pose()
  const firstAmbient = pose()
  targeted.applyInto(first, 1_616, 'idle')
  ambient.applyInto(firstAmbient, 1_616, 'idle')

  assert.equal(targeted.debugSignals().gazeSource, 'ambient')
  assert.ok(
    Math.abs(first[2].rotation - firstAmbient[2].rotation) < 0.0000001,
    'expansion cannot reveal the stale pointer through a head turn',
  )
  assert.ok(
    Math.abs(first[3].translation.x - firstAmbient[3].translation.x) < 0.0005,
    'the collapsed eye follower has returned instead of holding old x',
  )

  targeted.setGazeTarget(
    { x: -0.8, y: -0.15, attention: 1, source: 'pointer' },
    1_616,
  )
  targeted.applyInto(pose(), 1_632, 'idle')
  assert.equal(targeted.debugSignals().gazeSource, 'pointer')
})

test('pointer entering just after expansion uses the normal head delay and ease without a presentation jump', () => {
  const turning = new MotionRuntime(manifest)
  const stationary = new MotionRuntime(manifest)
  for (const runtime of [turning, stationary]) {
    runtime.setExpanded(false, 0)
    runtime.setGazeTarget(
      { x: -0.72, y: -0.12, attention: 1, source: 'camera' },
      0,
    )
    for (let now = 0; now <= 1_000; now += 100) {
      runtime.applyInto(pose(), now, 'idle')
    }
    runtime.setExpanded(true, 1_000)
    for (let now = 1_016; now <= 1_112; now += 16) {
      runtime.applyInto(pose(), now, 'idle')
    }
  }

  turning.setGazeTarget(
    { x: 0.92, y: -0.24, attention: 1, source: 'pointer' },
    1_112,
  )
  stationary.setGazeTarget(
    { x: -0.72, y: -0.12, attention: 1, source: 'pointer' },
    1_112,
  )

  const headDeltas: number[] = []
  const eyeDeltas: number[] = []
  for (let now = 1_128; now <= 1_416; now += 16) {
    const turningPose = pose()
    const stationaryPose = pose()
    turning.applyInto(turningPose, now, 'idle')
    stationary.applyInto(stationaryPose, now, 'idle')
    headDeltas.push(turningPose[2].rotation - stationaryPose[2].rotation)
    eyeDeltas.push(
      turningPose[3].translation.x - stationaryPose[3].translation.x,
    )
  }

  assert.ok(eyeDeltas[0] > 0, 'the eyes acknowledge the pointer immediately')
  assert.ok(
    headDeltas.slice(0, 8).every((value) => Math.abs(value) < 0.0000001),
    'the first 128ms retain the normal eye-only acquisition lead',
  )
  assert.ok(headDeltas[9] > 0, 'the head joins after the standard lead')
  assert.ok(
    headDeltas
      .slice(9)
      .every(
        (value, index, values) => index === 0 || value > values[index - 1],
      ),
    'head follow eases in monotonically instead of attaching on pointer entry',
  )
})

test('idle attention only adds bounded follow-through to whole handwear', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const watched = new MotionRuntime(layeredManifest)
  const ambient = new MotionRuntime(layeredManifest)
  watched.setCharacterState({ ...state, energy: 78, boredom: 72 })
  ambient.setCharacterState({ ...state, energy: 78, boredom: 72 })
  watched.setGazeTarget({ x: 1, y: -0.35, attention: 1 }, 0)

  let watchedPose = layeredManifest.bones.map(() => pose()[0])
  let ambientPose = layeredManifest.bones.map(() => pose()[0])
  for (let now = 0; now <= 800; now += 16) {
    watchedPose = layeredManifest.bones.map(() => pose()[0])
    ambientPose = layeredManifest.bones.map(() => pose()[0])
    watched.applyInto(watchedPose, now, 'idle')
    ambient.applyInto(ambientPose, now, 'idle')
  }

  assert.ok(watchedPose[3].translation.x > ambientPose[3].translation.x + 0.003)
  assert.ok(watchedPose[2].rotation > ambientPose[2].rotation + 0.008)
  assert.ok(Math.abs(watchedPose[8].rotation - ambientPose[8].rotation) < 0.006)
})

test('pointer gaze stays on eyes, head, and hair instead of steering the skeleton', () => {
  const targeted = new MotionRuntime(manifest)
  const ambient = new MotionRuntime(manifest)
  targeted.setGazeTarget({ x: -0.9, y: 0.4, attention: 1 }, 0)
  let targetedPose = pose()
  let ambientPose = pose()
  for (let now = 0; now <= 600; now += 16) {
    targetedPose = pose()
    ambientPose = pose()
    targeted.applyInto(targetedPose, now, 'idle')
    ambient.applyInto(ambientPose, now, 'idle')
    assert.deepEqual(targetedPose[0], ambientPose[0])
    assert.deepEqual(targetedPose[1], ambientPose[1])
  }
  assert.notEqual(targetedPose[2].rotation, ambientPose[2].rotation)
  assert.notEqual(targetedPose[3].translation.x, ambientPose[3].translation.x)
  assert.notEqual(targetedPose[6].rotation, ambientPose[6].rotation)
})

test('pointer gaze takes ambient head bones but yields them to greeting', () => {
  const overAmbient = new MotionRuntime(manifest)
  const underGreeting = new MotionRuntime(manifest)
  overAmbient.setGazeTarget({ x: 1, y: 0, attention: 1 }, 0)
  underGreeting.setGazeTarget({ x: 1, y: 0, attention: 1 }, 0)
  const occupied = manifest.bones.map((_, index) => [2, 3, 4].includes(index))
  const ambientPriorities = manifest.bones.map(
    () => RIG_ACTION_PRIORITY.ambientFidget,
  )
  const greetingPriorities = manifest.bones.map(
    () => RIG_ACTION_PRIORITY.greeting,
  )
  let ambientPose = pose()
  let greetingPose = pose()
  for (let now = 0; now <= 480; now += 16) {
    ambientPose = pose()
    greetingPose = pose()
    overAmbient.applyInto(
      ambientPose,
      now,
      'idle',
      occupied,
      ambientPriorities,
    )
    underGreeting.applyInto(
      greetingPose,
      now,
      'idle',
      occupied,
      greetingPriorities,
    )
  }
  assert.ok(ambientPose[3].translation.x > 0.004)
  assert.equal(greetingPose[3].translation.x, 0)
  assert.ok(ambientPose[2].rotation > greetingPose[2].rotation + 0.01)
})

test('greeting suppresses handwear sway and hands it back to idle gradually', () => {
  const layeredManifest = {
    ...manifest,
    parts: [{ id: 'a25d-face' }],
    bones: [
      ...manifest.bones,
      { id: 'a25d-handwear', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  const ordinaryPerformance = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 82, boredom: 90 })
  ordinaryPerformance.setCharacterState({ ...state, energy: 82, boredom: 90 })
  const greetingMask = layeredManifest.bones.map((_, index) => index === 2)
  const greetingPriorities = layeredManifest.bones.map(
    () => Number.NEGATIVE_INFINITY,
  )
  greetingPriorities[2] = RIG_ACTION_PRIORITY.greeting

  let duringGreeting = layeredManifest.bones.map(() => pose()[0])
  let duringOrdinaryPerformance = layeredManifest.bones.map(() => pose()[0])
  for (let now = 0; now <= 4_000; now += 16) {
    duringGreeting = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(
      duringGreeting,
      now,
      'idle',
      greetingMask,
      greetingPriorities,
      true,
    )
    duringOrdinaryPerformance = layeredManifest.bones.map(() => pose()[0])
    ordinaryPerformance.applyInto(
      duringOrdinaryPerformance,
      now,
      'idle',
      greetingMask,
      greetingPriorities,
    )
  }
  assert.equal(duringGreeting[8].rotation, 0)
  assert.notEqual(
    duringOrdinaryPerformance[8].rotation,
    0,
    'priority alone cannot turn a non-greeting performance into an idle lock',
  )

  const firstIdle = layeredManifest.bones.map(() => pose()[0])
  runtime.applyInto(firstIdle, 4_016, 'idle')
  const firstMagnitude = Math.abs(firstIdle[8].rotation)
  let settledIdle = firstIdle
  for (let now = 4_032; now <= 5_200; now += 16) {
    settledIdle = layeredManifest.bones.map(() => pose()[0])
    runtime.applyInto(settledIdle, now, 'idle')
  }
  const settledMagnitude = Math.abs(settledIdle[8].rotation)
  assert.ok(firstMagnitude < settledMagnitude * 0.2)
})

test('performance release finishes its head turn before the coordinated blink', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 25 })
  runtime.setGazeTarget({ x: 1, y: -0.4, attention: 1 }, 0)
  let focused = pose()
  for (let now = 0; now <= 800; now += 16) {
    focused = pose()
    runtime.applyInto(focused, now, 'idle')
  }
  runtime.releaseGazeWithBlink(800)

  let turnStart = pose()
  let turnEnd = pose()
  let minimumTurnEyeScale = 1
  let minimumPostTurnEyeScale = 1
  let settled = pose()
  for (let now = 816; now <= 1_920; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    if (now === 912) turnStart = output
    if (now === 1_280) turnEnd = output
    if (now >= 912 && now <= 1_280) {
      minimumTurnEyeScale = Math.min(minimumTurnEyeScale, output[3].scale.y)
    }
    if (now >= 1_360) {
      minimumPostTurnEyeScale = Math.min(
        minimumPostTurnEyeScale,
        output[3].scale.y,
      )
    }
    settled = output
  }

  assert.ok(
    minimumTurnEyeScale > 0.95,
    'eyelids stay open while the head basis is still rotating',
  )
  assert.ok(
    Math.abs(turnEnd[2].rotation) < Math.abs(turnStart[2].rotation),
    'the head turn settles before the queued blink',
  )
  assert.ok(
    minimumPostTurnEyeScale < 0.35,
    'the deferred soft blink still lands',
  )
  assert.ok(
    Math.abs(settled[3].translation.x) < Math.abs(focused[3].translation.x),
    'gaze eases back instead of snapping to centre',
  )
  assert.ok(settled[3].scale.y > 0.95, 'eyes reopen after the release')
})

test('vertical pointer gaze leads with the eyes and defers a queued blink until the head stops', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setGazeTarget({ x: 0, y: -1, attention: 1 }, 0)
  for (let now = 0; now <= 800; now += 16) {
    runtime.applyInto(pose(), now, 'idle')
  }

  // Queue the coordinated release blink, then immediately acquire a pointer
  // target in the opposite vertical direction. This exercises the race where
  // eye tracking and the already-pending blink begin on the same beat.
  runtime.releaseGazeWithBlink(800)
  runtime.setGazeTarget({ x: 0, y: 1, attention: 1 }, 800)

  let previousHeadY = 0
  let sawEyeLead = false
  let lastMovingAt = -Infinity
  let firstBlinkAt = Number.POSITIVE_INFINITY
  for (let now = 816; now <= 3_000; now += 16) {
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    const eyeY = output[3].translation.y
    const headY = output[2].translation.y
    if (now <= 880 && Math.abs(eyeY) > Math.abs(headY) * 2) sawEyeLead = true
    if (Math.abs(headY - previousHeadY) > 0.000035) {
      lastMovingAt = now
      assert.ok(output[3].scale.y > 0.95, 'head motion keeps the lids open')
    }
    if (output[3].scale.y < 0.8 && !Number.isFinite(firstBlinkAt)) {
      firstBlinkAt = now
    }
    previousHeadY = headY
  }

  assert.equal(sawEyeLead, true)
  assert.ok(Number.isFinite(firstBlinkAt), 'the queued blink still lands')
  assert.ok(
    firstBlinkAt > lastMovingAt,
    'the head reaches stillness before the blink begins',
  )
})

test('released attention returns eyes, head, and hair on staggered clocks', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 60, curiosity: 100 })
  runtime.setGazeTarget({ x: 1, y: -0.2, attention: 1 })
  runtime.applyInto(pose(), 0, 'idle')
  const focused = pose()
  runtime.applyInto(focused, 320, 'idle')
  runtime.releaseGazeWithBlink(320)

  const firstReturn = pose()
  runtime.applyInto(firstReturn, 352, 'idle')
  const eyeRetention = firstReturn[3].translation.x / focused[3].translation.x
  const headRetention = firstReturn[2].rotation / focused[2].rotation
  assert.ok(eyeRetention < headRetention, 'the eyes leave before the head')
  assert.ok(headRetention > 0.9, 'the head observes a short release delay')

  const middle = pose()
  runtime.applyInto(middle, 640, 'idle')
  const late = pose()
  runtime.applyInto(late, 980, 'idle')
  assert.ok(
    Math.abs(middle[6].rotation) > Math.abs(late[6].rotation),
    'hair keeps a delayed tail after the head starts returning',
  )
  assert.ok(
    Math.abs(late[2].rotation) < Math.abs(firstReturn[2].rotation),
    'the head settles after the eyes instead of remaining locked',
  )
})

test('low-energy release blink closes more slowly and holds the tired head lower', () => {
  const tired = new MotionRuntime(manifest)
  const alert = new MotionRuntime(manifest)
  tired.setCharacterState({ ...state, energy: 5 })
  alert.setCharacterState({ ...state, energy: 95 })
  for (const runtime of [tired, alert]) {
    runtime.applyInto(pose(), 0, 'idle')
    runtime.releaseGazeWithBlink(100)
  }
  const tiredPose = pose()
  const alertPose = pose()
  tired.applyInto(tiredPose, 800, 'idle')
  alert.applyInto(alertPose, 800, 'idle')

  assert.ok(tiredPose[3].scale.y < alertPose[3].scale.y - 0.25)
  assert.ok(tiredPose[2].translation.y > alertPose[2].translation.y + 0.003)
  assert.ok(tiredPose[2].rotation > alertPose[2].rotation + 0.005)
})

test('talking interruption preserves idle phase and rejoins secondary motion', () => {
  const uninterrupted = new MotionRuntime(manifest)
  const interrupted = new MotionRuntime(manifest)
  for (const runtime of [uninterrupted, interrupted]) {
    runtime.setCharacterState({ ...state, energy: 38 })
    runtime.applyInto(pose(), 0, 'idle')
  }
  for (let now = 16; now <= 3_000; now += 16) {
    uninterrupted.applyInto(pose(), now, 'idle')
    interrupted.applyInto(
      pose(),
      now,
      now < 1_000 ? 'idle' : now < 2_200 ? 'talking' : 'idle',
    )
  }
  const uninterruptedSignals = uninterrupted.signals(3_016, 'idle')
  const interruptedSignals = interrupted.signals(3_016, 'idle')
  assert.equal(interruptedSignals.breath, uninterruptedSignals.breath)
  assert.equal(interruptedSignals.weightShift, uninterruptedSignals.weightShift)
  assert.equal(interruptedSignals.gazeWander, uninterruptedSignals.gazeWander)
  assert.equal(
    interruptedSignals.secondaryDrift,
    uninterruptedSignals.secondaryDrift,
  )

  const beforeReturn = pose()
  interrupted.applyInto(beforeReturn, 3_032, 'idle')
  const afterReturn = pose()
  interrupted.applyInto(afterReturn, 3_048, 'idle')
  assert.ok(
    Math.abs(afterReturn[6].rotation - beforeReturn[6].rotation) < 0.02,
    'hair rejoins idle without resetting its spring',
  )
})

test('event impulses excite secondary bones through damped springs', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState(state)
  const output = pose()
  runtime.applyInto(output, 0, 'idle')
  runtime.triggerImpulse('poke-reaction', 76, 0)
  for (const now of [16, 32, 48, 64, 80, 96]) {
    runtime.applyInto(output, now, 'idle')
  }
  assert.notEqual(output[6].rotation, 0)
  assert.notEqual(output[7].rotation, 0)
  assert.ok(Math.abs(output[6].rotation) <= 0.28)
})

test('ambient stretch hair follows measured torso motion below a double-driven impulse reference', () => {
  const measured = new MotionRuntime(manifest)
  const doubleDriven = new MotionRuntime(manifest)
  measured.setAmbientFidgetActive(true)
  doubleDriven.setAmbientFidgetActive(true)
  doubleDriven.triggerImpulse('stretch', RIG_ACTION_PRIORITY.ambientFidget, 0)
  let measuredPeak = 0
  let doubleDrivenPeak = 0

  for (let now = 0; now <= 900; now += 16) {
    const progress = now / 900
    const torsoRotation = -Math.sin(progress * Math.PI) * 0.16
    const headRotation = -torsoRotation * 0.62
    const measuredPose = pose()
    const doubleDrivenPose = pose()
    for (const output of [measuredPose, doubleDrivenPose]) {
      output[1].rotation = torsoRotation
      output[2].rotation = headRotation
    }
    measured.applyInto(measuredPose, now, 'idle')
    doubleDriven.applyInto(doubleDrivenPose, now, 'idle')
    measuredPeak = Math.max(measuredPeak, Math.abs(measuredPose[6].rotation))
    doubleDrivenPeak = Math.max(
      doubleDrivenPeak,
      Math.abs(doubleDrivenPose[6].rotation),
    )
  }

  assert.ok(measuredPeak > 0.001, 'measured follow-through remains visible')
  assert.ok(
    measuredPeak < doubleDrivenPeak * 0.9,
    'removing the same-frame generic impulse materially reduces additive hair overshoot',
  )
})

test('hair tips and cloth follow body changes in distinct delayed layers', () => {
  const layeredManifest = {
    ...manifest,
    bones: [
      ...manifest.bones,
      { id: 'hair-tip', parent: 'front-hair' },
      { id: 'skirt-cloth', parent: 'body' },
    ],
  } as CompanionRigManifest
  const runtime = new MotionRuntime(layeredManifest)
  runtime.setCharacterState({ ...state, energy: 15 })
  runtime.applyInto(
    layeredManifest.bones.map(() => pose()[0]),
    0,
    'idle',
  )

  const early = layeredManifest.bones.map(() => pose()[0])
  early[1].rotation = -0.1
  early[2].rotation = 0.12
  runtime.applyInto(early, 16, 'idle')
  const earlyRoot = Math.abs(early[6].rotation)
  const earlyTip = Math.abs(early[8].rotation)
  const earlyCloth = Math.abs(early[9].rotation)

  let settled = early
  for (const now of [32, 48, 64, 80, 112, 144, 176]) {
    settled = layeredManifest.bones.map(() => pose()[0])
    settled[1].rotation = -0.1
    settled[2].rotation = 0.12
    runtime.applyInto(settled, now, 'idle')
  }

  assert.ok(earlyRoot > earlyTip, 'the hair root leads its tip')
  assert.ok(earlyCloth > 0, 'the cloth receives the torso change')
  assert.ok(
    Math.abs(settled[8].rotation) > earlyTip,
    'the hair tip catches up after the root',
  )
  assert.notEqual(
    Math.abs(settled[9].rotation),
    Math.abs(settled[6].rotation),
    'cloth and hair retain different response timing',
  )
})

test('secondary motion carries transition velocity then comes to a gradual stop', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 55 })
  runtime.applyInto(pose(), 0, 'idle')

  const moving = pose()
  moving[2].rotation = 0.18
  runtime.applyInto(moving, 16, 'idle')
  const stopped = pose()
  stopped[2].rotation = 0.18
  runtime.applyInto(stopped, 32, 'idle')
  const firstTail = pose()
  firstTail[2].rotation = 0.18
  runtime.applyInto(firstTail, 48, 'idle')
  const earlyTravel = Math.abs(firstTail[6].rotation - stopped[6].rotation)

  let previous = firstTail[6].rotation
  let lateTravel = earlyTravel
  for (let now = 64; now <= 1_600; now += 16) {
    const output = pose()
    output[2].rotation = 0.18
    runtime.applyInto(output, now, 'idle')
    lateTravel = Math.abs(output[6].rotation - previous)
    previous = output[6].rotation
  }

  assert.ok(earlyTravel > 0.00001, 'hair keeps moving after the head stops')
  assert.ok(
    lateTravel < earlyTravel * 0.35,
    'the remaining motion decays slowly',
  )
})

test('large head turns drive hair and accessories by angular velocity with layered stops', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 72 })
  runtime.applyInto(pose(), 0, 'idle')
  let turning = pose()
  for (let now = 16; now <= 160; now += 16) {
    turning = pose()
    turning[2].rotation = 0.34 * (now / 160)
    runtime.applyInto(turning, now, 'idle')
  }
  const stoppedSamples: Array<{ hair: number; accessory: number }> = []
  for (let now = 176; now <= 1_600; now += 16) {
    const output = pose()
    output[2].rotation = 0.34
    runtime.applyInto(output, now, 'idle')
    stoppedSamples.push({
      hair: output[6].rotation,
      accessory: output[7].rotation,
    })
  }
  const early = stoppedSamples[3]
  const middle = stoppedSamples[20]
  const beforeLate = stoppedSamples.at(-2)!
  const late = stoppedSamples.at(-1)!

  assert.ok(turning[6].rotation < -0.002, 'hair trails the head turn')
  assert.ok(
    turning[7].rotation < -0.002,
    'the accessory receives head velocity',
  )
  assert.ok(
    Math.abs(early.hair - early.accessory) > 0.0005,
    'hair and accessory do not move in one phase',
  )
  assert.notEqual(
    Math.abs(middle.hair - early.hair).toFixed(5),
    Math.abs(middle.accessory - early.accessory).toFixed(5),
  )
  assert.ok(
    Math.abs(late.hair - beforeLate.hair) < 0.0002 &&
      Math.abs(late.accessory - beforeLate.accessory) < 0.0002,
    'both layers eventually settle after the head stops',
  )
})

test('low-energy hair starts later instead of fluttering at alert speed', () => {
  const tired = new MotionRuntime(manifest)
  const alert = new MotionRuntime(manifest)
  tired.setCharacterState({ ...state, energy: 5 })
  alert.setCharacterState({ ...state, energy: 95 })
  tired.applyInto(pose(), 0, 'idle')
  alert.applyInto(pose(), 0, 'idle')

  const tiredMoved = pose()
  const alertMoved = pose()
  tiredMoved[2].rotation = 0.18
  alertMoved[2].rotation = 0.18
  tired.applyInto(tiredMoved, 16, 'idle')
  alert.applyInto(alertMoved, 16, 'idle')

  assert.ok(
    Math.abs(tiredMoved[6].rotation) < Math.abs(alertMoved[6].rotation) * 0.7,
    'tired hair receives the same head change with a lazier initial response',
  )
})

test('garment topology scales secondary follow-through without disabling it', () => {
  const fitted = new MotionRuntime(manifest)
  const armored = new MotionRuntime({
    ...manifest,
    outfitProfile: {
      topologies: ['armor'],
      secondaryPartIds: [],
      torsoTwistScale: 0.62,
      secondaryMotionScale: 0.45,
    },
  })
  const fittedPose = pose()
  const armoredPose = pose()
  fitted.applyInto(fittedPose, 0, 'idle')
  armored.applyInto(armoredPose, 0, 'idle')
  fitted.triggerImpulse('poke-reaction', 100, 0)
  armored.triggerImpulse('poke-reaction', 100, 0)
  for (const now of [16, 32, 48, 64, 80, 96]) {
    fitted.applyInto(fittedPose, now, 'idle')
    armored.applyInto(armoredPose, now, 'idle')
  }
  assert.ok(Math.abs(armoredPose[6].rotation) > 0)
  assert.ok(
    Math.abs(armoredPose[6].rotation) < Math.abs(fittedPose[6].rotation),
  )
})

test('explicit outfit secondary parts animate even with custom bone names', () => {
  const customManifest = {
    ...manifest,
    bones: [...manifest.bones, { id: 'fabric-panel-17', parent: 'body' }],
    outfitProfile: {
      topologies: ['fitted'],
      secondaryPartIds: ['fabric-panel-17'],
      torsoTwistScale: 1,
      secondaryMotionScale: 1,
    },
  } as CompanionRigManifest
  const runtime = new MotionRuntime(customManifest)
  const output = customManifest.bones.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
  runtime.applyInto(output, 0, 'idle')
  runtime.triggerImpulse('poke-reaction', 100, 0)
  for (const now of [16, 32, 48, 64, 80, 96]) {
    runtime.applyInto(output, now, 'idle')
  }
  assert.notEqual(output.at(-1)?.rotation, 0)
})

test('secondary collision pushes a chain tip out of the body volume', () => {
  const rotation = resolveSecondaryCollision(
    0,
    { x: 0.5, y: 0.5 },
    0.08,
    { x: 0.54, y: 0.56 },
    0.1,
  )
  assert.notEqual(rotation, 0)
  assert.ok(Number.isFinite(rotation))
})

test('clock reset prevents a hidden-tab gap from destabilizing springs', () => {
  const runtime = new MotionRuntime(manifest)
  const output = pose()
  runtime.applyInto(output, 0, 'idle')
  runtime.triggerImpulse('notify', 100, 0)
  runtime.applyInto(output, 16, 'idle')
  runtime.resetClock(120_000)
  runtime.applyInto(output, 120_016, 'idle')
  assert.ok(output.every((transform) => Number.isFinite(transform.rotation)))
  assert.ok(Math.abs(output[6].rotation) <= 0.28)
})

test('secondary springs stay inside a recoverable envelope over long idle', () => {
  const runtime = new MotionRuntime(manifest)
  runtime.setCharacterState({ ...state, energy: 92, boredom: 95 })
  let maximumRotation = 0
  for (let now = 0; now <= 30 * 60_000; now += 100) {
    if (now % 45_000 === 0) runtime.triggerImpulse('notify', 140, now)
    const output = pose()
    runtime.applyInto(output, now, 'idle')
    for (const index of [6, 7]) {
      maximumRotation = Math.max(
        maximumRotation,
        Math.abs(output[index].rotation),
      )
      assert.ok(Number.isFinite(output[index].rotation))
    }
  }
  assert.ok(maximumRotation > 0.01)
  assert.ok(maximumRotation <= 0.28 * 0.94 + 0.000001)
})

test('applies a live motion profile without rebuilding the renderer', () => {
  const runtime = new MotionRuntime(manifest)
  const output = pose()
  runtime.setMotionProfile({
    seed: 9,
    breath: {
      minFrequencyHz: 0.2,
      maxFrequencyHz: 0.2,
      amplitude: 0.01,
    },
    blink: {
      minIntervalSeconds: 3,
      maxIntervalSeconds: 3,
      durationSeconds: 0.2,
      doubleChance: 0,
    },
    secondary: {
      enabled: false,
      frequencyHz: 2,
      dampingRatio: 0.5,
      response: 0.5,
    },
  })
  runtime.applyInto(output, 0, 'idle')
  runtime.triggerImpulse('poke', 76, 0)
  runtime.applyInto(output, 32, 'idle')
  assert.equal(output[6].rotation, 0)
  assert.equal(output[7].rotation, 0)
})
