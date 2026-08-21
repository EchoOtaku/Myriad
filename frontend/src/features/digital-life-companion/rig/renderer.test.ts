import type { RigTransformVelocity } from './transitions'
import type { CompanionRigManifest, RigClip } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPoseBuffer } from './animation'
import { SPEECH_MOUTH_CLOSE_MS, speechMouthReleaseWeight } from './motion'
import {
  activeUrgentRenderUntilMs,
  activityTransitionDuration,
  activityTransitionWeight,
  ambientFidgetAllowed,
  anime25DOpenEyeSlot,
  anime25DStencilMode,
  blinkPeakPreservesCollapsedCadence,
  canQueueOneShotGroup,
  canSupersedePendingWakeActions,
  COLLAPSED_RIG_FRAME_INTERVAL_MS,
  collapsedRigFrameDelayMs,
  collapseOneShotReleaseDurationMs,
  collapseReleaseBlocksGreeting,
  collapseReleaseChannelOwnsShoulderRecovery,
  composeOneShotHandoffInto,
  computeRigFit,
  dampedVelocityDisplacement,
  deferredAmbientFidgetForPriorityTakeover,
  expansionNeedsLiveLidSample,
  expansionPoseForCurrentPhase,
  expressionAssetVariant,
  extrapolateDampedPoseInto,
  FacialVariantMixer,
  handoffSettleSecondsForBone,
  isAmbientFidgetPriority,
  locksIdleHandoffNeedsStationarySnapshot,
  motionChannelForBone,
  motionChannelMasks,
  oneShotBlendWeight,
  oneShotHandoffMask,
  oneShotHandoffProfile,
  oneShotNaturalReleaseLeadSeconds,
  oneShotReleaseWeight,
  oneShotTransitionDuration,
  pendingWakeActionIsCurrent,
  pointerGazeOwnsBone,
  presentationIntentCoverage,
  queuedOneShotChannelIsReady,
  resolveAvailablePartVariants,
  resolveExpressionChannels,
  retainedExpansionPose,
  RIG_ACTION_PRIORITY,
  RigAnimationFrameOwnership,
  rigPartRenderDepth,
  scheduledRigClockOwnsFrame,
  selectFacialVariants,
  selectPartVariants,
  selectPartVariantsInto,
  shouldQueueOneShot,
  shouldRenderRigFrame,
  shouldScheduleRigAnimationFrame,
  speechVisemeAfterEnergySample,
  speechVisemeForPresentation,
  transitionPresentationClip,
  visibilityResumeSettleDurationMs,
  visibilityResumeStrategy,
  writeBoneMatrices,
  writeOneShotHandoffMask,
  writePoseVelocity,
} from './renderer'

test('hidden-tab resume uses a bounded settle window instead of a cut', () => {
  const shortPause = visibilityResumeSettleDurationMs(120)
  const longPause = visibilityResumeSettleDurationMs(120_000)
  assert.ok(shortPause >= 300)
  assert.ok(longPause > shortPause)
  assert.ok(longPause <= 520)
  assert.equal(visibilityResumeSettleDurationMs(Number.NaN), 300)
})

test('collapsed rigs downsample while expansion resumes full cadence immediately', () => {
  const lastRenderedAt = 1_000
  assert.equal(
    shouldRenderRigFrame(
      false,
      lastRenderedAt + COLLAPSED_RIG_FRAME_INTERVAL_MS - 1,
      lastRenderedAt,
    ),
    false,
  )
  assert.equal(
    shouldRenderRigFrame(
      false,
      lastRenderedAt + COLLAPSED_RIG_FRAME_INTERVAL_MS,
      lastRenderedAt,
    ),
    true,
  )
  assert.equal(shouldRenderRigFrame(true, 1_016, lastRenderedAt), true)
  assert.equal(
    shouldRenderRigFrame(false, 1_016, lastRenderedAt, true),
    true,
    'a collapsed viseme release renders before its visible close deadline',
  )
  assert.equal(shouldRenderRigFrame(false, 900, lastRenderedAt), true)
})

test('collapsed rigs schedule one physics-and-paint tick per 100ms interval', () => {
  assert.equal(collapsedRigFrameDelayMs(1_016, 1_000), 84)
  assert.equal(collapsedRigFrameDelayMs(1_099, 1_000), 1)
  assert.equal(collapsedRigFrameDelayMs(1_100, 1_000), 0)
  assert.equal(collapsedRigFrameDelayMs(1_240, 1_000), 0)
  assert.equal(collapsedRigFrameDelayMs(900, 1_000), 0)
  assert.equal(collapsedRigFrameDelayMs(1_000, 0), 0)
})

test('a precise blink sample preserves cadence unless its timer arrives late', () => {
  assert.equal(
    blinkPeakPreservesCollapsedCadence(true, false, 1_060, 1_000),
    true,
  )
  assert.equal(
    blinkPeakPreservesCollapsedCadence(true, false, 1_100, 1_000),
    false,
    'a late peak callback becomes the already-due cadence tick',
  )
  assert.equal(
    blinkPeakPreservesCollapsedCadence(true, false, 1_060, 1_000, true),
    false,
    'an urgent render window already owns the paint cadence',
  )
  assert.equal(
    blinkPeakPreservesCollapsedCadence(true, true, 1_060, 1_000),
    false,
  )
  assert.equal(
    blinkPeakPreservesCollapsedCadence(false, false, 1_060, 1_000),
    false,
  )
})

test('expansion samples the current shared breath/lid phase before rAF takes over', () => {
  const retained = [transform(0.24)]
  assert.strictEqual(retainedExpansionPose(1_100, retained), retained)
  assert.equal(retainedExpansionPose(0, retained), null)
  assert.equal(retainedExpansionPose(1_100, []), null)
  assert.strictEqual(
    expansionPoseForCurrentPhase(1_100, retained, 1_100, false),
    retained,
    'an already-current pose does not integrate the shared clock twice',
  )
  assert.equal(
    expansionPoseForCurrentPhase(1_100, retained, 1_116, false),
    null,
    'an in-between click samples breath from the retained collapsed phase',
  )
  assert.equal(
    expansionPoseForCurrentPhase(1_100, retained, 1_100, true),
    null,
    'a live or stale retained lid phase is sampled instead of replayed',
  )
  assert.equal(expansionNeedsLiveLidSample(true, false, 0), true)
  assert.equal(expansionNeedsLiveLidSample(false, true, 0), true)
  assert.equal(expansionNeedsLiveLidSample(false, false, 0.42), true)
  assert.equal(expansionNeedsLiveLidSample(false, false, 0), false)
})

test('collapsed runtime refreshes cannot upgrade the rig scheduler to 60fps', () => {
  assert.equal(shouldScheduleRigAnimationFrame(false, 1_000, 0), false)
  assert.equal(shouldScheduleRigAnimationFrame(true, 1_000, 0), true)
  assert.equal(
    shouldScheduleRigAnimationFrame(false, 1_000, 1_120),
    true,
    'only an explicit urgent render window may temporarily use rAF collapsed',
  )
  assert.equal(shouldScheduleRigAnimationFrame(false, 1_121, 1_120), false)
  assert.equal(activeUrgentRenderUntilMs(1_120, 1_120), 1_120)
  assert.equal(activeUrgentRenderUntilMs(1_121, 1_120), 0)
  assert.equal(
    shouldScheduleRigAnimationFrame(
      false,
      1_121,
      activeUrgentRenderUntilMs(1_121, 1_120),
    ),
    false,
    'the completed emergency window returns to the collapsed timer',
  )
  assert.equal(
    collapsedRigFrameDelayMs(1_121, 1_104),
    83,
    'the first post-emergency callback waits out the remainder of the 10 FPS slot',
  )
  assert.equal(shouldRenderRigFrame(false, 1_203, 1_104), false)
  assert.equal(shouldRenderRigFrame(false, 1_204, 1_104), true)
})

test('urgent viseme rAF invalidates an already-queued blink peak clock', () => {
  const blinkTimerGeneration = 12
  const urgentRafGeneration = 13
  assert.equal(
    scheduledRigClockOwnsFrame(blinkTimerGeneration, urgentRafGeneration, true),
    false,
    'the stale blink callback cannot consume dt after urgent rAF takes ownership',
  )
  assert.equal(
    scheduledRigClockOwnsFrame(urgentRafGeneration, urgentRafGeneration, true),
    false,
    'only one clock may own a generation even if both callbacks are queued',
  )
  assert.equal(
    scheduledRigClockOwnsFrame(urgentRafGeneration, urgentRafGeneration, false),
    true,
  )
})

test('a queued urgent rAF cannot claim the expanded main-loop clock', () => {
  const ownership = new RigAnimationFrameOwnership()
  const urgentSlot = ownership.allocateSlot()
  ownership.setRequest(urgentSlot, 41)

  const cancelled: number[] = []
  ownership.cancelAll((requestId) => cancelled.push(requestId))
  const expandedSlot = ownership.allocateSlot()
  ownership.setRequest(expandedSlot, 42)

  assert.deepEqual(cancelled, [41])
  assert.notEqual(expandedSlot, urgentSlot)
  assert.equal(
    ownership.claim(urgentSlot),
    false,
    'the already-queued urgent callback no longer owns runtime dt',
  )
  assert.equal(ownership.hasPending(), true)
  assert.equal(ownership.claim(expandedSlot), true)
  assert.equal(ownership.hasPending(), false)
})

test('rAF ownership treats a wrapped zero request id as live', () => {
  const ownership = new RigAnimationFrameOwnership()
  const slot = ownership.allocateSlot()
  ownership.setRequest(slot, 0)
  assert.equal(ownership.hasPending(), true)

  const cancelled: number[] = []
  ownership.cancelAll((requestId) => cancelled.push(requestId))
  assert.deepEqual(cancelled, [0])
  assert.equal(ownership.claim(slot), false)
})

test('hidden-tab resume keeps collapsed rigs on their 100ms continuity path', () => {
  assert.equal(visibilityResumeStrategy(false), 'collapsed-tick')
  assert.equal(visibilityResumeStrategy(true), 'expanded-handoff')
})

test('collapsed viseme release paints a fully closed mouth within 150ms', () => {
  const releaseStartedAt = 1_010
  const urgentUntil = releaseStartedAt + SPEECH_MOUTH_CLOSE_MS + 17
  let lastRenderedAt = 1_000
  let firstPaintedClosedAt = Number.POSITIVE_INFINITY

  for (let now = 1_016; now <= 1_200; now += 16) {
    if (!shouldRenderRigFrame(false, now, lastRenderedAt, now <= urgentUntil)) {
      continue
    }
    lastRenderedAt = now
    if (speechMouthReleaseWeight(now - releaseStartedAt) === 0) {
      firstPaintedClosedAt = now
      break
    }
  }

  assert.ok(firstPaintedClosedAt - releaseStartedAt <= 150)
})

test('live speech presentation keeps its viseme while the body wake gate opens', () => {
  assert.equal(speechVisemeForPresentation(true, 'wide'), 'wide')
  assert.equal(speechVisemeForPresentation(true, 'round'), 'round')
  assert.equal(speechVisemeForPresentation(false, 'wide'), 'rest')
})

test('energy-only speech uses an open slot and clears stale visemes on release', () => {
  assert.equal(speechVisemeAfterEnergySample('rest', 0.72), 'open')
  assert.equal(speechVisemeAfterEnergySample('wide', 0.64), 'wide')
  assert.equal(speechVisemeAfterEnergySample('round', null), 'rest')
})

test('overlay collapse releases live one-shots through the velocity handoff window', () => {
  const releaseMs = collapseOneShotReleaseDurationMs(true, false)
  assert.equal(releaseMs, 420)
  assert.equal(collapseOneShotReleaseDurationMs(false, false), null)
  assert.equal(collapseOneShotReleaseDurationMs(false, true), null)
  assert.equal(collapseOneShotReleaseDurationMs(true, true), null)

  assert.ok(oneShotReleaseWeight(1, 100 / releaseMs!) > 0)
  assert.equal(oneShotReleaseWeight(1, releaseMs! / releaseMs!), 0)
})

test('a reopen greeting waits behind the overlapping collapse release', () => {
  assert.equal(
    collapseReleaseBlocksGreeting(['upper'], ['face', 'upper'], true),
    true,
  )
  assert.equal(
    collapseReleaseBlocksGreeting(['upper'], ['face', 'head'], true),
    false,
    'non-overlapping channels remain independent',
  )
  assert.equal(
    collapseReleaseBlocksGreeting(['upper'], ['upper'], false),
    false,
    'non-locking actions retain normal channel handoff behavior',
  )
  assert.equal(
    queuedOneShotChannelIsReady(null, 330, true),
    false,
    'an empty active slot cannot bypass its retained collapse release',
  )
  assert.equal(queuedOneShotChannelIsReady(null, 330, false), true)
  assert.equal(queuedOneShotChannelIsReady(331, 330, false), false)
  assert.equal(queuedOneShotChannelIsReady(330, 330, false), true)
})

test('a first-frame greeting uses a zero-velocity retained head handoff', () => {
  assert.equal(
    locksIdleHandoffNeedsStationarySnapshot(true, false, 8_000),
    true,
  )
  assert.equal(
    locksIdleHandoffNeedsStationarySnapshot(true, true, 8_000),
    false,
    'measured velocity remains authoritative when two composed frames exist',
  )
  assert.equal(
    locksIdleHandoffNeedsStationarySnapshot(false, false, 8_000),
    false,
    'ordinary one-shots keep their existing fade-in path',
  )
  assert.equal(
    locksIdleHandoffNeedsStationarySnapshot(true, false, 0),
    false,
    'a renderer with no retained pose cannot synthesize ownership history',
  )

  const retained = createPoseBuffer(1)
  retained[0].rotation = 0.18
  const zeroVelocity: RigTransformVelocity[] = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 0, y: 0 },
    },
  ]
  const atBoundary = createPoseBuffer(1)
  const afterBoundary = createPoseBuffer(1)
  extrapolateDampedPoseInto(atBoundary, retained, zeroVelocity, 0, 0.17)
  extrapolateDampedPoseInto(afterBoundary, retained, zeroVelocity, 0.016, 0.17)
  assert.deepEqual(afterBoundary, atBoundary)
})

test('a blocking upper-body collapse release exclusively owns shoulder recovery', () => {
  assert.equal(collapseReleaseChannelOwnsShoulderRecovery('upper', true), true)
  assert.equal(collapseReleaseChannelOwnsShoulderRecovery('full', true), true)
  assert.equal(collapseReleaseChannelOwnsShoulderRecovery('head', true), false)
  assert.equal(
    collapseReleaseChannelOwnsShoulderRecovery('upper', false),
    false,
    'ordinary handoffs do not suppress live procedural shoulders',
  )
})

const presentationManifest = {
  clips: [
    {
      ...presented('cheer', 'happy'),
      presentation: {
        expression: 'happy',
        keyframes: [
          { progress: 0, expression: 'neutral' },
          { progress: 0.2, expression: 'happy' },
          { progress: 0.8, expression: 'happy' },
          { progress: 1, expression: 'neutral' },
        ],
      },
    },
    presented('facepalm', 'sad'),
    presented('startle-settle', 'surprise'),
  ],
} as CompanionRigManifest

function presented(id: string, expression?: 'happy' | 'sad' | 'surprise') {
  return {
    id,
    duration: 1,
    looping: false,
    tracks: [],
    presentation: { expression },
  }
}

test('fits a non-square rig without clipping and keeps it bottom-aligned', () => {
  const fit = computeRigFit(380, 660, 1, 1.5)
  assert.ok(Math.abs(fit[0] - 0.9) < 0.000001)
  assert.ok(fit[2] > 0)
  assert.ok(fit[3] > 0)
  assert.ok(Math.abs(fit[1] * 1.5 + fit[3] - 1) < 0.000001)
})

test('reserves motion-safe headroom while keeping the source floor planted', () => {
  const fit = computeRigFit(660, 660, 1, 1)
  assert.ok(Math.abs(fit[0] - 0.9) < 0.000001)
  assert.ok(Math.abs(fit[1] - 0.9) < 0.000001)
  assert.ok(Math.abs(fit[2] - 0.05) < 0.000001)
  assert.ok(Math.abs(fit[1] + fit[3] - 1) < 0.000001)
})

test('composes parent and child matrices into reusable buffers', () => {
  const output = new Float32Array(32 * 9)
  const local = new Float32Array(32 * 9)
  const world = new Float32Array(32 * 9)
  writeBoneMatrices(
    output,
    local,
    world,
    [
      {
        translation: { x: 0.1, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      {
        translation: { x: 0, y: 0.2 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
    ],
    [-1, 0],
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    [0, 1],
  )
  assert.ok(Math.abs(output[6] - 0.1) < 0.000001)
  assert.ok(Math.abs(output[9 + 6] - 0.1) < 0.000001)
  assert.ok(Math.abs(output[9 + 7] - 0.2) < 0.000001)
  assert.equal(output[18], 1)
  assert.equal(output[18 + 4], 1)
  assert.equal(output[18 + 8], 1)
})

test('uses authored FaceRig layer depth without limb-specific overrides', () => {
  assert.equal(rigPartRenderDepth({ id: 'body', zIndex: 10 }), 10)
  assert.equal(rigPartRenderDepth({ id: 'a25d-handwear', zIndex: 8_600 }), 8_600)
  assert.equal(rigPartRenderDepth({ id: 'a25d-topwear', zIndex: 9_000 }), 9_000)
})

test('honors explicit action interrupt windows', () => {
  assert.equal(shouldQueueOneShot(80, 100, 'queue'), true)
  assert.equal(shouldQueueOneShot(80, 20, 'if-lower'), true)
  assert.equal(shouldQueueOneShot(80, 100, 'if-lower'), false)
  assert.equal(shouldQueueOneShot(100, 10, 'replace'), false)
  assert.equal(shouldQueueOneShot(null, 10, 'queue'), false)
})

test('admits or rejects queued actions as one coherent channel group', () => {
  assert.equal(canQueueOneShotGroup([null, 40, 80], 80), true)
  assert.equal(canQueueOneShotGroup([null, 40, 80], 79), false)
  assert.equal(canQueueOneShotGroup([], 10), true)
})

test('keeps speech state transitions responsive without snapping ambient states', () => {
  assert.equal(activityTransitionDuration('idle', 'idle'), 0)
  assert.equal(activityTransitionDuration('idle', 'talking'), 220)
  assert.equal(activityTransitionDuration('talking', 'thinking'), 220)
  assert.equal(activityTransitionDuration('idle', 'thinking'), 280)
})

test('ambient activity handoffs ease both endpoints without a pose cut', () => {
  assert.equal(activityTransitionWeight(-1), 0)
  assert.equal(activityTransitionWeight(0), 0)
  assert.equal(activityTransitionWeight(0.5), 0.5)
  assert.equal(activityTransitionWeight(1), 1)
  assert.equal(activityTransitionWeight(2), 1)
  const epsilon = 0.0001
  assert.ok(activityTransitionWeight(epsilon) / epsilon < 0.001)
  assert.ok((1 - activityTransitionWeight(1 - epsilon)) / epsilon < 0.001)
})

test('uses channel-aware overlap windows and bounded custom transitions', () => {
  assert.equal(oneShotTransitionDuration(['face']), 180)
  assert.equal(oneShotTransitionDuration(['upper', 'head']), 230)
  assert.equal(oneShotTransitionDuration(['upper'], 40), 100)
  assert.equal(oneShotTransitionDuration(['upper'], 900), 520)
})

test('common performances get shoulder-and-hair-safe idle handoff windows', () => {
  const greet = oneShotHandoffProfile('greet', ['upper'])
  const nod = oneShotHandoffProfile('nod', ['head'])
  const breath = oneShotHandoffProfile('deep-breath', ['upper', 'head'])
  const generic = oneShotHandoffProfile('custom-action', ['upper'])
  assert.deepEqual(greet, {
    transitionMs: 330,
    fadeInMs: 190,
    fadeOutMs: 330,
  })
  assert.deepEqual(nod, {
    transitionMs: 310,
    fadeInMs: 170,
    fadeOutMs: 310,
  })
  assert.deepEqual(breath, {
    transitionMs: 420,
    fadeInMs: 260,
    fadeOutMs: 420,
  })
  assert.ok(greet.fadeOutMs > generic.fadeOutMs)
  assert.equal(
    oneShotHandoffProfile('deep-breath', ['upper'], { transitionMs: 180 })
      .transitionMs,
    180,
  )
})

test('the rest of the common performance catalog uses full velocity handoff windows', () => {
  for (const clipId of [
    'surprise',
    'proud',
    'shy',
    'poke-reaction',
    'startle-settle',
    'sigh',
  ]) {
    const profile = oneShotHandoffProfile(clipId, ['upper', 'head'])
    assert.ok(profile.transitionMs >= 310, clipId)
    assert.ok(profile.fadeOutMs >= 310, clipId)
  }
})

test('secondary bones retain inherited angular velocity while the root stays fixed', () => {
  const settleSeconds = ['root', 'head', 'front-hair'].map((boneId) =>
    handoffSettleSecondsForBone(boneId),
  )
  const previous = createPoseBuffer(3)
  const ending = createPoseBuffer(3)
  const velocity: RigTransformVelocity[] = previous.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 0, y: 0 },
  }))
  ending[1].rotation = 0.12
  ending[2].rotation = -0.045
  writePoseVelocity(velocity, previous, ending, 0.1)

  const early = createPoseBuffer(3)
  const middle = createPoseBuffer(3)
  const late = createPoseBuffer(3)
  extrapolateDampedPoseInto(early, ending, velocity, 0.016, settleSeconds)
  extrapolateDampedPoseInto(middle, ending, velocity, 0.24, settleSeconds)
  extrapolateDampedPoseInto(late, ending, velocity, 1.2, settleSeconds)

  assert.equal(early[0].translation.x, 0)
  assert.equal(early[0].translation.y, 0)
  assert.equal(early[0].rotation, 0)
  assert.ok(Math.abs(early[1].rotation) > Math.abs(ending[1].rotation))
  assert.ok(Math.abs(early[2].rotation) > Math.abs(ending[2].rotation))
  assert.ok(
    Math.abs(late[2].rotation - middle[2].rotation) <
      Math.abs(middle[2].rotation - early[2].rotation),
    'the hair tail decelerates instead of cutting to its rest angle',
  )
})

test('interaction arbitration orders wake, greeting, pointer gaze, and ambient fidget', () => {
  assert.ok(RIG_ACTION_PRIORITY.wake > RIG_ACTION_PRIORITY.greeting)
  assert.ok(RIG_ACTION_PRIORITY.greeting > RIG_ACTION_PRIORITY.pointerGaze)
  assert.ok(RIG_ACTION_PRIORITY.pointerGaze > RIG_ACTION_PRIORITY.ambientFidget)
  assert.equal(pointerGazeOwnsBone(RIG_ACTION_PRIORITY.ambientFidget), true)
  assert.equal(pointerGazeOwnsBone(RIG_ACTION_PRIORITY.greeting), false)
  assert.equal(ambientFidgetAllowed(0.999), false)
  assert.equal(ambientFidgetAllowed(1), true)
  assert.equal(ambientFidgetAllowed(1, 1), false)
  assert.equal(ambientFidgetAllowed(1, 0), true)
  assert.equal(ambientFidgetAllowed(1, 0, true), false)
  assert.equal(ambientFidgetAllowed(1, 0, false, true), false)
  assert.equal(ambientFidgetAllowed(1, 0, false, false, 0.8), false)
  assert.equal(ambientFidgetAllowed(1, 0, false, false, 0.081), false)
  assert.equal(ambientFidgetAllowed(1, 0, false, false, 0.08), true)
  assert.equal(isAmbientFidgetPriority(RIG_ACTION_PRIORITY.ambientFidget), true)
  assert.equal(isAmbientFidgetPriority(RIG_ACTION_PRIORITY.pointerGaze), false)
  assert.equal(
    canSupersedePendingWakeActions(
      [RIG_ACTION_PRIORITY.greeting],
      RIG_ACTION_PRIORITY.wake,
    ),
    true,
  )
  assert.equal(
    canSupersedePendingWakeActions(
      [RIG_ACTION_PRIORITY.wake],
      RIG_ACTION_PRIORITY.greeting,
    ),
    false,
  )
  assert.equal(
    canSupersedePendingWakeActions(
      [RIG_ACTION_PRIORITY.greeting],
      RIG_ACTION_PRIORITY.greeting,
    ),
    true,
    'equal-priority expansion greetings coalesce instead of replaying',
  )
})

test('a greeting preserves the exact wake-pending fidget for a later retry', () => {
  const fidget = {
    clipId: 'stretch',
    priority: RIG_ACTION_PRIORITY.ambientFidget,
    style: { variationSeed: 17, tempo: 0.84 },
  }
  const greeting = {
    clipId: 'greet',
    priority: RIG_ACTION_PRIORITY.greeting,
    style: {},
  }
  assert.strictEqual(
    deferredAmbientFidgetForPriorityTakeover(
      null,
      [greeting, fidget],
      RIG_ACTION_PRIORITY.greeting,
    ),
    fidget,
    'the selected clip and variation survive greeting priority takeover',
  )
  assert.equal(
    deferredAmbientFidgetForPriorityTakeover(
      null,
      [fidget],
      RIG_ACTION_PRIORITY.ambientFidget,
    ),
    null,
    'an equal-priority fidget cannot turn a normal refresh into a takeover',
  )
  const alreadyDeferred = { ...fidget, clipId: 'look-around' }
  assert.strictEqual(
    deferredAmbientFidgetForPriorityTakeover(
      alreadyDeferred,
      [fidget],
      RIG_ACTION_PRIORITY.greeting,
    ),
    alreadyDeferred,
    'later timer callbacks do not redraw an already deferred choice',
  )
})

test('deferred wake actions are invalidated by collapse or a newer generation', () => {
  assert.equal(pendingWakeActionIsCurrent(7, 7, true), true)
  assert.equal(pendingWakeActionIsCurrent(7, 8, true), false)
  assert.equal(pendingWakeActionIsCurrent(7, 7, false), false)
})

test('one-shot envelopes enter and leave without an endpoint jump', () => {
  assert.equal(oneShotBlendWeight(0, 2, 200, 300), 0)
  assert.equal(oneShotBlendWeight(0.1, 2, 200, 300), 0.5)
  assert.equal(oneShotBlendWeight(1, 2, 200, 300), 1)
  assert.ok(oneShotBlendWeight(1.85, 2, 200, 300) < 1)
  assert.equal(oneShotBlendWeight(2, 2, 200, 300), 0)
  const epsilon = 0.000001
  assert.ok(oneShotBlendWeight(epsilon, 2, 200, 300) / epsilon < 0.001)
  assert.ok(oneShotBlendWeight(2 - epsilon, 2, 200, 300) / epsilon < 0.001)
})

test('natural action endings enter the velocity-carrying release window', () => {
  assert.equal(oneShotNaturalReleaseLeadSeconds(2, 300), 0.3)
  assert.equal(oneShotNaturalReleaseLeadSeconds(0.5, 400), 0.175)
  assert.equal(oneShotNaturalReleaseLeadSeconds(1, -20), 0)
  assert.equal(oneShotNaturalReleaseLeadSeconds(-1, 300), 0)
})

test('exclusive channel release preserves entry velocity and settles at rest', () => {
  assert.equal(oneShotReleaseWeight(0.8, 0), 0.8)
  assert.equal(oneShotReleaseWeight(0.8, 1), 0)
  const epsilon = 0.0001
  const entrySlope =
    (oneShotReleaseWeight(0.8, epsilon) - oneShotReleaseWeight(0.8, 0)) /
    epsilon
  const exitSlope =
    (oneShotReleaseWeight(0.8, 1) - oneShotReleaseWeight(0.8, 1 - epsilon)) /
    epsilon
  assert.ok(Math.abs(entrySlope) < 0.001)
  assert.ok(Math.abs(exitSlope) < 0.001)
})

test('rapid retargeting carries the currently rendered pose and velocity', () => {
  const previous = [transform(0)]
  const current = [transform(0.12)]
  current[0].translation.x = 0.03
  const velocity = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 0, y: 0 },
    },
  ]
  writePoseVelocity(velocity, previous, current, 0.03)
  const output = [transform(0)]
  extrapolateDampedPoseInto(output, current, velocity, 0)
  assert.deepEqual(output, current)

  const epsilon = 0.00001
  extrapolateDampedPoseInto(output, current, velocity, epsilon)
  assert.ok(
    Math.abs((output[0].rotation - current[0].rotation) / epsilon - 4) < 0.01,
  )
  assert.ok(
    Math.abs(
      (output[0].translation.x - current[0].translation.x) / epsilon - 1,
    ) < 0.01,
  )
  assert.ok(dampedVelocityDisplacement(1) < 0.121)
})

test('secondary bones retain inherited angular velocity longer than the core', () => {
  assert.ok(
    handoffSettleSecondsForBone('front-hair') >
      handoffSettleSecondsForBone('head'),
  )
  assert.ok(
    handoffSettleSecondsForBone('head') > handoffSettleSecondsForBone('root'),
  )
  const source = [transform(0), transform(0)]
  const velocity = [
    { translation: { x: 0, y: 0 }, rotation: 1, scale: { x: 0, y: 0 } },
    { translation: { x: 0, y: 0 }, rotation: 1, scale: { x: 0, y: 0 } },
  ]
  const output = [transform(0), transform(0)]
  extrapolateDampedPoseInto(output, source, velocity, 0.3, [0.12, 0.24])
  assert.ok(output[1].rotation > output[0].rotation)
})

test('expression presentation switches at the body handoff midpoint', () => {
  assert.equal(transitionPresentationClip('greet', 'nod', 0), 'greet')
  assert.equal(transitionPresentationClip('greet', 'nod', 0.49), 'greet')
  assert.equal(transitionPresentationClip('greet', 'nod', 0.5), 'nod')
  assert.equal(transitionPresentationClip(null, 'nod', 0), 'nod')
})

test('handoff composition keeps the outgoing pose and joins incoming velocity', () => {
  const sample = (time: number) => {
    const output = [transform(0)]
    composeOneShotHandoffInto(
      output,
      [transform(0)],
      [transform(0)],
      [transform(1 + time)],
      [transform(-1 + time * 2)],
      1,
      time,
      [true],
    )
    return output[0].rotation
  }
  assert.ok(Math.abs(sample(0) - 1) < 0.000001)
  assert.ok(Math.abs(sample(1) - 1) < 0.000001)
  const epsilon = 0.0001
  const entryVelocity = (sample(epsilon) - sample(0)) / epsilon
  const exitVelocity = (sample(1) - sample(1 - epsilon)) / epsilon
  assert.ok(Math.abs(entryVelocity - 1) < 0.01)
  assert.ok(Math.abs(exitVelocity - 2) < 0.01)
})

test('preempted-only bones release through the union mask back to live base', () => {
  const base = [transform(0.2), transform(0.4)]
  const outgoing = [transform(1), transform(2)]
  const incoming = [transform(3), transform(4)]
  const output = [transform(0), transform(0)]
  const scratch = [transform(0), transform(0)]

  composeOneShotHandoffInto(
    output,
    scratch,
    base,
    outgoing,
    incoming,
    1,
    0.5,
    [true, true],
    [true, false],
  )
  assert.ok(Math.abs(output[0].rotation - 2) < 0.000001)
  assert.ok(Math.abs(output[1].rotation - 1.2) < 0.000001)

  composeOneShotHandoffInto(
    output,
    scratch,
    base,
    outgoing,
    incoming,
    1,
    1,
    [true, true],
    [true, false],
  )
  assert.equal(output[0].rotation, 3)
  assert.ok(Math.abs(output[1].rotation - 0.4) < 0.000001)
})

test('the union handoff mask is dropped on the exact completion frame', () => {
  const incoming = [true, false]
  const union = [true, true]
  assert.equal(oneShotHandoffMask(incoming, union, 0.999), union)
  assert.equal(oneShotHandoffMask(incoming, union, 1), incoming)
  assert.equal(oneShotHandoffMask(incoming, undefined, 0.5), incoming)
})

test('preemption writes its union into a caller-owned mask buffer', () => {
  const output = [false, false, false]
  const retained = writeOneShotHandoffMask(
    output,
    [true, false, false],
    [false, true, false],
  )
  assert.equal(retained, output)
  assert.deepEqual(output, [true, true, false])

  assert.equal(writeOneShotHandoffMask(output, [false, false, true]), retained)
  assert.deepEqual(output, [false, false, true])
})

test('preemption, natural release, and greeting release keep bone ownership continuous', () => {
  const incoming = [true, false]
  const union = writeOneShotHandoffMask([false, false], incoming, [false, true])
  assert.equal(oneShotHandoffMask(incoming, union, 0), union)
  assert.equal(oneShotHandoffMask(incoming, union, 0.999), union)
  assert.equal(oneShotHandoffMask(incoming, union, 1), incoming)

  const sourceBlend = oneShotBlendWeight(1.7, 2, 200, 300)
  assert.equal(sourceBlend, 1)
  assert.equal(oneShotReleaseWeight(sourceBlend, 0), sourceBlend)
  assert.ok(oneShotReleaseWeight(sourceBlend, 0.5) > 0)
  assert.equal(oneShotReleaseWeight(sourceBlend, 1), 0)

  assert.equal(ambientFidgetAllowed(1, 0, true), false)
  assert.equal(ambientFidgetAllowed(1, 1, false), false)
  assert.equal(ambientFidgetAllowed(1, 0, false), true)
})

test('classifies semantic bones into independently mixable motion channels', () => {
  assert.equal(motionChannelForBone('left-eye'), 'face')
  assert.equal(motionChannelForBone('front-hair'), 'head')
  assert.equal(motionChannelForBone('a25d-handwear'), 'upper')
  assert.equal(motionChannelForBone('body'), 'upper')
  assert.equal(motionChannelForBone('root'), 'full')
})

test('splits a FaceRig clip mask across face, head, upper and full channels', () => {
  const manifest = {
    bones: [
      { id: 'root' },
      { id: 'head' },
      { id: 'mouth' },
      { id: 'body' },
      { id: 'a25d-handwear' },
    ],
  } as CompanionRigManifest
  const clip = {
    tracks: manifest.bones.map((bone) => ({ boneId: bone.id, keyframes: [] })),
  } as RigClip
  const masks = motionChannelMasks(manifest, clip)
  assert.deepEqual(
    masks.map(({ channel }) => channel),
    ['full', 'head', 'face', 'upper'],
  )
  assert.deepEqual(
    masks.map(({ mask }) => mask.filter(Boolean).length),
    [1, 1, 1, 2],
  )
})

test('facial slots select discrete blink, emotion, and viseme textures', () => {
  const pose = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 0.2 },
    },
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
  ]
  const selected = selectFacialVariants(
    ['cheer'],
    'round',
    pose,
    {
      'left-eye': 0,
      'right-eye': 1,
    },
    presentationManifest,
  )
  assert.equal(selected['eye-left'], 'closed')
  assert.equal(selected['eye-right'], 'open')
  assert.equal(selected['brow-left'], 'happy')
  assert.equal(selected.mouth, 'round')
})

test('Anime2.5DRig two-frame mouth keeps every speech viseme visibly open', () => {
  const manifest = {
    bones: [{ id: 'mouth', parent: 'face' }],
    parts: [
      { id: 'a25d-mouth-close', slot: 'mouth', variant: 'closed' },
      { id: 'a25d-mouth-open', slot: 'mouth', variant: 'open' },
    ],
    clips: [],
  } as unknown as CompanionRigManifest
  const pose = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
  ]
  for (const viseme of ['wide', 'round', 'narrow'] as const) {
    const selected = selectPartVariants([], viseme, pose, {}, false, manifest)
    assert.equal(selected.mouth, 'open')
  }
  assert.equal(
    selectPartVariants([], 'rest', pose, {}, false, manifest).mouth,
    'closed',
  )
})

test('Anime2.5DRig eye masks and irises follow the open-lid crossfade', () => {
  assert.equal(anime25DOpenEyeSlot('a25d-eyewhite-left'), 'eye-left')
  assert.equal(anime25DOpenEyeSlot('a25d-irides-right'), 'eye-right')
  assert.equal(anime25DOpenEyeSlot('a25d-eyelash-left'), null)
  assert.equal(anime25DOpenEyeSlot('face'), null)
  assert.equal(anime25DStencilMode('a25d-eyewhite-left'), 'mask')
  assert.equal(anime25DStencilMode('a25d-irides-right'), 'clip')
  assert.equal(anime25DStencilMode('a25d-eyelash-left'), 'none')
})

test('idle facial selection reuses its caller-owned variant record', () => {
  const output: Record<string, string> = {}
  const active = new Set<string>()
  const openPose = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
  ]
  const first = selectPartVariantsInto(output, active, 'rest', openPose, {
    'left-eye': 0,
    'right-eye': 0,
  })
  const second = selectPartVariantsInto(output, active, 'rest', openPose, {
    'left-eye': 0,
    'right-eye': 0,
  })

  assert.strictEqual(first, output)
  assert.strictEqual(second, output)
  assert.equal(output['eye-left'], 'open')
  assert.equal(output.mouth, 'closed')
})

test('nuanced expressions resolve onto actual split or full-head asset frames', () => {
  assert.equal(expressionAssetVariant(['warm']), 'happy')
  assert.equal(expressionAssetVariant(['playful']), 'happy')
  assert.equal(expressionAssetVariant(['concerned']), 'sad')
  assert.equal(expressionAssetVariant(['focused']), 'neutral')
  const selected = selectPartVariants(['concerned'], 'rest', [], {}, true)
  assert.equal(selected['head-expression'], 'sad')
  assert.equal(selected['eye-frame'], 'sad')
  assert.deepEqual(
    resolveExpressionChannels(['facepalm'], presentationManifest),
    {
      frame: 'sad',
      brow: 'worried',
      restingMouth: 'sad',
    },
  )
  assert.deepEqual(resolveExpressionChannels(['cheer'], presentationManifest), {
    frame: 'happy',
    brow: 'happy',
    restingMouth: 'smile',
  })
  assert.deepEqual(
    resolveExpressionChannels(['startle-settle'], presentationManifest),
    {
      frame: 'surprise',
      brow: 'worried',
      restingMouth: 'surprised',
    },
  )
})

test('samples expression assets from clip-owned presentation progress', () => {
  const atStart = new Map([['cheer', 0]])
  const atApex = new Map([['cheer', 0.5]])
  const atSettle = new Map([['cheer', 1]])
  assert.equal(
    expressionAssetVariant(['cheer'], presentationManifest, atStart),
    'neutral',
  )
  assert.equal(
    expressionAssetVariant(['cheer'], presentationManifest, atApex),
    'happy',
  )
  assert.equal(
    expressionAssetVariant(['cheer'], presentationManifest, atSettle),
    'neutral',
  )
})

test('facial variants crossfade instead of popping between textures', () => {
  const mixer = new FacialVariantMixer()
  mixer.update({ mouth: 'closed' }, 0)
  assert.equal(mixer.opacity('mouth', 'closed', 100), 1)
  mixer.update({ mouth: 'open' }, 100)
  assert.equal(mixer.opacity('mouth', 'closed', 100), 1)
  assert.equal(mixer.opacity('mouth', 'open', 100), 0)
  assert.ok(mixer.opacity('mouth', 'closed', 134) > 0)
  assert.ok(mixer.opacity('mouth', 'open', 134) > 0)
  assert.equal(mixer.opacity('mouth', 'open', 200), 1)
  mixer.update({ mouth: 'closed' }, 200)
  assert.ok(mixer.opacity('mouth', 'open', 275) > 0)
  assert.ok(mixer.opacity('mouth', 'closed', 275) > 0)
  assert.equal(mixer.opacity('mouth', 'open', 350), 0)
  assert.equal(mixer.opacity('mouth', 'closed', 350), 1)

  mixer.update({ 'head-expression': 'neutral' }, 600)
  mixer.update({ 'head-expression': 'happy' }, 800)
  assert.ok(
    mixer.drawOrder('head-expression', 'neutral') <
      mixer.drawOrder('head-expression', 'happy'),
  )
  const headPrevious = mixer.opacity('head-expression', 'neutral', 870)
  const headCurrent = mixer.opacity('head-expression', 'happy', 870)
  assert.equal(headPrevious, 1)
  assert.ok(headCurrent > 0 && headCurrent < 1)
  assert.equal(headCurrent + headPrevious * (1 - headCurrent), 1)
  assert.equal(mixer.opacity('head-expression', 'neutral', 940), 0)
  assert.equal(mixer.opacity('head-expression', 'happy', 940), 1)
})

test('facial expression releases in staggered layers after an action ends', () => {
  const mixer = new FacialVariantMixer()
  mixer.update(
    {
      'head-expression': 'happy',
      'eye-frame': 'happy',
      'brow-left': 'happy',
      mouth: 'smile',
    },
    0,
  )
  mixer.update(
    {
      'head-expression': 'neutral',
      'eye-frame': 'neutral',
      'brow-left': 'neutral',
      mouth: 'closed',
    },
    200,
  )

  assert.ok(mixer.opacity('brow-left', 'neutral', 390) === 1)
  assert.ok(mixer.opacity('mouth', 'smile', 390) > 0)
  assert.ok(mixer.opacity('mouth', 'closed', 390) > 0)
  assert.ok(mixer.opacity('head-expression', 'happy', 420) > 0)
  assert.ok(mixer.opacity('head-expression', 'neutral', 420) < 1)
  assert.equal(mixer.opacity('head-expression', 'happy', 460), 0)
  assert.equal(mixer.opacity('head-expression', 'neutral', 460), 1)
})

test('partial character asset sets fall back without hiding mouths', () => {
  const partial = {
    parts: [
      { slot: 'mouth', variant: 'closed' },
      { slot: 'mouth', variant: 'open' },
    ],
  } as CompanionRigManifest
  assert.deepEqual(
    resolveAvailablePartVariants(
      {
        mouth: 'sad',
      },
      partial,
    ),
    {
      mouth: 'closed',
    },
  )
})

test('legacy custom slots keep a stable visible drawing', () => {
  const legacy = {
    parts: [
      { slot: 'custom-emblem', variant: 'lit' },
      { slot: 'custom-emblem', variant: 'dim' },
    ],
  } as CompanionRigManifest
  assert.equal(
    resolveAvailablePartVariants({ mouth: 'closed' }, legacy)['custom-emblem'],
    'lit',
  )
  const mixer = new FacialVariantMixer()
  mixer.update(resolveAvailablePartVariants({}, legacy), 0)
  assert.equal(mixer.opacity('custom-emblem', 'lit', 200), 1)
  assert.equal(mixer.opacity('custom-emblem', 'dim', 200), 0)
})

test('reports authored presentation intent not supported by partial assets', () => {
  const partial = {
    ...presentationManifest,
    parts: [
      { slot: 'head-expression', variant: 'neutral' },
      { slot: 'head-expression', variant: 'happy' },
    ],
  } as CompanionRigManifest
  const coverage = presentationIntentCoverage(partial)
  assert.ok(coverage.required > coverage.supported)
  assert.ok(
    coverage.gaps.some(
      (gap) =>
        gap.clipId === 'facepalm' &&
        gap.channel === 'expression' &&
        gap.variant === 'sad',
    ),
  )
})

test('does not mistake a mouth drawing for a complete facial expression', () => {
  const mouthOnly = {
    clips: [presented('cheer', 'happy')],
    parts: [
      { slot: 'mouth', variant: 'closed' },
      { slot: 'mouth', variant: 'smile' },
    ],
  } as CompanionRigManifest
  const coverage = presentationIntentCoverage(mouthOnly)
  assert.equal(coverage.required, 1)
  assert.equal(coverage.supported, 0)
  assert.deepEqual(coverage.gaps, [
    { clipId: 'cheer', channel: 'expression', variant: 'happy' },
  ])
})

test('full-head expression slots replace fragile eye and skin-patch overlays', () => {
  const pose = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 0.2 },
    },
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
  ]
  const blink = selectPartVariants(
    [],
    'rest',
    pose,
    { 'left-eye': 0, 'right-eye': 1 },
    true,
    presentationManifest,
  )
  assert.equal(blink['head-expression'], 'blink')
  assert.equal(blink['eye-frame'], 'blink')
  assert.equal(blink['iris-left'], 'hidden')
  assert.equal(blink['iris-right'], 'hidden')
  assert.equal(blink['eye-left'], 'open')
  assert.equal(blink.mouth, 'closed')

  const sad = selectPartVariants(
    ['sad'],
    'rest',
    pose.map((item) => ({ ...item, scale: { x: 1, y: 1 } })),
    { 'left-eye': 0, 'right-eye': 1 },
    true,
    presentationManifest,
  )
  assert.equal(sad['head-expression'], 'sad')
  assert.equal(sad['eye-frame'], 'sad')
  assert.equal(sad['iris-left'], 'visible')
  assert.equal(sad.mouth, 'closed')

  const startled = selectPartVariants(
    ['startle-settle'],
    'rest',
    pose.map((item) => ({ ...item, scale: { x: 1, y: 1 } })),
    { 'left-eye': 0, 'right-eye': 1 },
    true,
    presentationManifest,
  )
  assert.equal(startled['head-expression'], 'surprise')
})

test('blink overrides emotion frames so irises never remain visible through closed lids', () => {
  const pose = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 0.2 },
    },
  ]
  const selected = selectPartVariants(
    ['happy'],
    'rest',
    pose,
    { 'left-eye': 0, 'right-eye': 0 },
    true,
  )
  assert.equal(selected['head-expression'], 'blink')
  assert.equal(selected['iris-left'], 'hidden')
  assert.equal(selected['iris-right'], 'hidden')
})

function transform(rotation: number) {
  return {
    translation: { x: 0, y: 0 },
    rotation,
    scale: { x: 1, y: 1 },
  }
}
