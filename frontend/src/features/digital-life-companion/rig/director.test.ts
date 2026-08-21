import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIdleAccentTimerLoop,
  fidgetCandidateRotation,
  gestureSelectionIndex,
  nextIdleBehaviorMode,
  resolveRigGesture,
  resolveRigStateGesture,
  shouldScheduleIdleAccent,
  startIdleAccentTimerLoop,
} from './director'

const manifest = {
  clips: [
    { id: 'idle', looping: true },
    { id: 'greet', looping: false },
    { id: 'blink', looping: false },
    { id: 'happy', looping: false },
    { id: 'sad', looping: false },
    { id: 'sleep', looping: false },
    { id: 'observe', looping: false },
    { id: 'nod', looping: false },
    { id: 'pat-reaction', looping: false },
    { id: 'poke-reaction', looping: false },
  ],
} as CompanionRigManifest

test('selects the first available non-looping gesture fallback', () => {
  assert.deepEqual(resolveRigGesture(manifest, 'greet'), {
    clipId: 'greet',
    priority: 80,
    intensity: 0.92,
    tempo: 1,
  })
  assert.deepEqual(resolveRigGesture(manifest, 'idle-accent'), {
    clipId: 'blink',
    priority: 10,
    intensity: 0.55,
    tempo: 0.82,
  })
})

test('state continuously modulates action intensity and tempo', () => {
  const tired = resolveRigStateGesture(manifest, {
    energy: 10,
    mood: 50,
    boredom: 70,
  })
  const lively = resolveRigStateGesture(manifest, {
    energy: 90,
    mood: 50,
    boredom: 70,
  })
  assert.ok(tired && lively)
  assert.ok(lively.intensity > tired.intensity)
  assert.ok(lively.tempo > tired.tempo)
})

test('idle planner enters rest and fidget early without threshold chatter', () => {
  assert.equal(nextIdleBehaviorMode('idle', { energy: 34, boredom: 0 }), 'rest')
  assert.equal(nextIdleBehaviorMode('rest', { energy: 41, boredom: 0 }), 'rest')
  assert.equal(nextIdleBehaviorMode('rest', { energy: 43, boredom: 0 }), 'idle')
  assert.equal(
    nextIdleBehaviorMode('idle', { energy: 80, boredom: 56 }),
    'fidget',
  )
  assert.equal(
    nextIdleBehaviorMode('fidget', { energy: 80, boredom: 49 }),
    'fidget',
  )
  assert.equal(
    nextIdleBehaviorMode('fidget', { energy: 80, boredom: 46 }),
    'idle',
  )
  assert.equal(
    nextIdleBehaviorMode('fidget', { energy: 20, boredom: 90 }),
    'rest',
  )
})

test('rest mode does not schedule recurring idle accents', () => {
  assert.equal(shouldScheduleIdleAccent('rest'), false)
  assert.equal(shouldScheduleIdleAccent('idle'), true)
  assert.equal(shouldScheduleIdleAccent('fidget'), true)
})

test('collapse cancellation stops the director fidget timer permanently', () => {
  const callbacks = new Map<number, () => void>()
  const cleared: number[] = []
  let nextTimer = 1
  let fired = 0
  const cancel = startIdleAccentTimerLoop(
    () => 8_000,
    () => {
      fired += 1
    },
    {
      setTimeout: (callback) => {
        const timer = nextTimer++
        callbacks.set(timer, callback)
        return timer
      },
      clearTimeout: (timer) => {
        cleared.push(timer)
      },
    },
  )

  assert.equal(callbacks.size, 1)
  const staleCallback = callbacks.get(1)
  cancel()
  assert.deepEqual(cleared, [1])

  // Browsers can already have moved a timer callback into the task queue when
  // clearTimeout runs. The generation-local cancelled guard must still win.
  staleCallback?.()
  assert.equal(fired, 0)
  assert.equal(nextTimer, 2, 'a stale callback cannot schedule another timer')
})

test('a collapse observed inside the fidget callback cannot re-arm its timer', () => {
  let callback: (() => void) | undefined
  let schedules = 0
  let expanded = true
  startIdleAccentTimerLoop(
    () => 8_000,
    () => (expanded ? undefined : false),
    {
      setTimeout: (nextCallback) => {
        schedules += 1
        callback = nextCallback
        return schedules
      },
      clearTimeout: () => {},
    },
  )

  expanded = false
  callback?.()
  assert.equal(schedules, 1)
})

test('collapsed fidget cooldown freezes and resumes from its remaining time', () => {
  const callbacks = new Map<number, () => void>()
  const scheduledDelays: number[] = []
  let clockNow = 1_000
  let nextTimer = 1
  let fired = 0
  const loop = createIdleAccentTimerLoop(
    () => 8_000,
    () => {
      fired += 1
    },
    {
      now: () => clockNow,
      setTimeout: (callback, delayMs) => {
        const timer = nextTimer++
        callbacks.set(timer, callback)
        scheduledDelays.push(delayMs)
        return timer
      },
      clearTimeout: () => {},
    },
  )

  loop.resume()
  const staleCollapsedCallback = callbacks.get(1)
  clockNow += 3_250
  loop.pause()
  assert.equal(loop.remainingDelayMs(), 4_750)

  clockNow += 60_000
  loop.resume()
  assert.deepEqual(scheduledDelays, [8_000, 4_750])
  assert.equal(fired, 0, 'resume does not synchronously emit a fidget')
  staleCollapsedCallback?.()
  assert.equal(
    fired,
    0,
    'a queued pre-collapse task cannot consume cooldown after resume',
  )
  assert.equal(nextTimer, 3, 'the stale task cannot replace the resumed timer')
  assert.equal(loop.remainingDelayMs(), 4_750)
  clockNow += 4_750
  callbacks.get(2)?.()
  assert.equal(fired, 1)
  assert.equal(scheduledDelays.at(-1), 8_000)
})

test('fidget timer ownership accepts zero as a valid browser clock id', () => {
  let clockNow = 0
  const cleared: number[] = []
  const loop = createIdleAccentTimerLoop(
    () => 5_000,
    () => {},
    {
      now: () => clockNow,
      setTimeout: () => 0,
      clearTimeout: (timer) => cleared.push(timer),
    },
  )

  loop.resume()
  clockNow = 1_250
  loop.pause()
  assert.deepEqual(cleared, [0])
  assert.equal(loop.remainingDelayMs(), 3_750)
})

test('held idle behavior mode selects its matching clip family', () => {
  assert.equal(
    resolveRigStateGesture(
      manifest,
      { energy: 38, mood: 80, boredom: 20 },
      {
        behaviorMode: 'rest',
      },
    )?.clipId,
    'sleep',
  )
  assert.equal(
    resolveRigStateGesture(
      manifest,
      { energy: 80, mood: 25, boredom: 50 },
      {
        behaviorMode: 'fidget',
      },
    )?.clipId,
    'observe',
  )
})

test('fidget lanes rotate by boredom and energy instead of repeating one clip', () => {
  const fidgetManifest = {
    clips: [
      { id: 'deep-breath', looping: false },
      { id: 'look-around', looping: false },
      { id: 'idle-accent', looping: false },
      { id: 'proud', looping: false },
      { id: 'sigh', looping: false },
      { id: 'happy', looping: false },
    ],
  } as CompanionRigManifest
  const energetic = Array.from(
    { length: 4 },
    (_, fidgetSequence) =>
      resolveRigStateGesture(
        fidgetManifest,
        { energy: 76, mood: 55, boredom: 88 },
        { behaviorMode: 'fidget', fidgetSequence, seed: 0 },
      )?.clipId,
  )
  assert.deepEqual(energetic, [
    'deep-breath',
    'look-around',
    'idle-accent',
    'proud',
  ])
  const highBoredomPool = Array.from(
    { length: 4 },
    (_, sequence) =>
      fidgetCandidateRotation({ energy: 82, boredom: 96 }, sequence).primary,
  ).flat()
  assert.equal(highBoredomPool.includes('bounce'), false)
  assert.equal(highBoredomPool.includes('march-in-place'), false)
  assert.equal(highBoredomPool.includes('cautious-step'), false)
  assert.equal(highBoredomPool.includes('stretch'), false)
  assert.deepEqual(
    fidgetCandidateRotation({ energy: 38, boredom: 88 }, 0).primary,
    ['look-around', 'observe'],
  )
})

test('fidget selection separates two uses of the same clip when alternatives exist', () => {
  const fidgetManifest = {
    clips: [
      { id: 'deep-breath', looping: false },
      { id: 'look-around', looping: false },
      { id: 'idle-accent', looping: false },
    ],
  } as CompanionRigManifest
  const selected = resolveRigStateGesture(
    fidgetManifest,
    { energy: 78, mood: 55, boredom: 90 },
    {
      behaviorMode: 'fidget',
      fidgetSequence: 0,
      seed: 0,
      avoid: ['deep-breath'],
    },
  )
  assert.notEqual(selected?.clipId, 'deep-breath')
})

test('high boredom fallback never turns scheduling into locomotion', () => {
  const fallbackManifest = {
    clips: [
      { id: 'cautious-step', looping: false },
      { id: 'march-in-place', looping: false },
      { id: 'look-around', looping: false },
      { id: 'observe', looping: false },
      { id: 'deep-breath', looping: false },
      { id: 'idle-accent', looping: false },
    ],
  } as CompanionRigManifest
  const selected = Array.from(
    { length: 24 },
    (_, seed) =>
      resolveRigStateGesture(
        fallbackManifest,
        { energy: 78, mood: 55, boredom: 92 },
        { seed },
      )?.clipId,
  )

  assert.equal(selected.includes('cautious-step'), false)
  assert.equal(selected.includes('march-in-place'), false)
  assert.ok(selected.includes('look-around'))
  assert.ok(selected.includes('observe'))
})

test('does not reuse looping clips as one-shot gestures', () => {
  assert.equal(
    resolveRigGesture(
      {
        clips: [{ id: 'listen', looping: true }],
      } as CompanionRigManifest,
      'listen',
    ),
    null,
  )
})

test('chooses state-driven actions without pointer gaze', () => {
  assert.equal(
    resolveRigStateGesture(manifest, { energy: 20, mood: 80, boredom: 10 })
      ?.clipId,
    'sleep',
  )
  assert.equal(
    resolveRigStateGesture(manifest, { energy: 80, mood: 25, boredom: 10 })
      ?.clipId,
    'sad',
  )
  assert.equal(
    resolveRigStateGesture(manifest, { energy: 80, mood: 85, boredom: 10 })
      ?.clipId,
    'happy',
  )
  assert.equal(
    resolveRigStateGesture(manifest, { energy: 80, mood: 60, boredom: 80 })
      ?.clipId,
    'observe',
  )
  assert.equal(resolveRigGesture(manifest, 'pat')?.clipId, 'pat-reaction')
  assert.equal(resolveRigGesture(manifest, 'poke')?.clipId, 'poke-reaction')
})

test('resolves semantic performance intents through available clip fallbacks', () => {
  assert.equal(resolveRigGesture(manifest, 'question')?.clipId, 'observe')
  assert.equal(resolveRigGesture(manifest, 'emphasize')?.clipId, 'nod')
  assert.equal(resolveRigGesture(manifest, 'delight')?.clipId, 'happy')
})

test('varies available actions deterministically and avoids recent clips', () => {
  assert.equal(
    resolveRigGesture(manifest, 'greet', { seed: 0 })?.clipId,
    'greet',
  )
  assert.equal(
    resolveRigGesture(manifest, 'greet', { seed: 1 })?.clipId,
    'nod',
  )
  assert.equal(
    resolveRigGesture(manifest, 'greet', { seed: 0, avoid: ['greet'] })?.clipId,
    'nod',
  )
})

test('returns to the least-recently-used clip after the action pool is exhausted', () => {
  assert.equal(
    resolveRigGesture(manifest, 'greet', {
      seed: 0,
      avoid: ['greet'],
    })?.clipId,
    'nod',
  )
  assert.equal(
    resolveRigGesture(manifest, 'greet', {
      seed: 0,
      avoid: ['nod', 'greet'],
    })?.clipId,
    'greet',
  )
})

test('honors a visible phrase candidate pool before generic intent fallbacks', () => {
  assert.equal(
    resolveRigGesture(manifest, 'question', {
      seed: 0,
      prefer: ['happy', 'nod'],
    })?.clipId,
    'happy',
  )
  assert.equal(
    resolveRigGesture(manifest, 'question', {
      seed: 0,
      prefer: ['missing'],
    })?.clipId,
    'observe',
  )
})

test('breaks periodic aliasing between repeated phrases and three-item pools', () => {
  const indexes = new Set(
    Array.from({ length: 12 }, (_, cycle) =>
      gestureSelectionIndex(cycle * 9, 3),
    ),
  )
  assert.deepEqual(gestureSelectionIndex(0, 2), 0)
  assert.deepEqual(gestureSelectionIndex(1, 2), 1)
  assert.equal(indexes.size, 3)
})
