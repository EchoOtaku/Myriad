import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyMotionCueContinuity,
  generateMotionPhrase,
  motionPlanFromMessageMeta,
  motionTextSignals,
  planCompanionMotion,
  previewMotionPlan,
} from './planner'

const state = {
  energy: 70,
  mood: 68,
  boredom: 25,
  curiosity: 70,
  social: 64,
  affection: 58,
}

test('extracts multilingual performance signals without model output', () => {
  assert.deepEqual(motionTextSignals('你好！今天也许会很棒？'), {
    greeting: true,
    question: true,
    uncertain: true,
    positive: false,
    emphatic: true,
    apology: false,
    farewell: false,
    playful: false,
  })
  assert.equal(motionTextSignals('Thanks, that is wonderful!').positive, true)
})

test('selects full performances only for high-confidence reply semantics', () => {
  assert.equal(
    planCompanionMotion({ text: '真的太好了！', state }).performanceId,
    'celebration',
  )
  assert.equal(
    planCompanionMotion({ text: '对不起，让你久等了。', state }).performanceId,
    'apology',
  )
  assert.equal(
    planCompanionMotion({ text: '晚安，我们回头见。', state }).performanceId,
    'farewell',
  )
  assert.equal(
    planCompanionMotion({ text: '我已经处理好了。', state }).performanceId,
    undefined,
  )
  assert.equal(
    planCompanionMotion({
      text: '太好了！',
      source: 'proactive',
      state,
    }).performanceId,
    undefined,
  )
})

test('plans a bounded phrase sequence for uncertain replies', () => {
  const plan = planCompanionMotion({
    text: '也许可以，让我想想？',
    state,
  })
  assert.equal(plan.cues[0].intent, 'question')
  assert.ok(plan.cues.some((cue) => cue.intent === 'respond'))
  assert.ok(plan.cues.length <= 3)
  assert.ok(plan.cues.every((cue) => cue.atMs < plan.durationHintMs))
  assert.equal(plan.cues[0].interrupt, 'replace')
  assert.equal(plan.cues[1].interrupt, 'queue')
  assert.equal(plan.cues[1].transitionMs, 380)
})

test('adapts overlap duration to conversational handoffs and temporal gaps', () => {
  const cue = previewMotionPlan('respond', state).cues[0]
  const continuous = applyMotionCueContinuity([
    { ...cue, intent: 'question', atMs: 0, transitionMs: 260 },
    { ...cue, intent: 'respond', atMs: 420, transitionMs: 260 },
    { ...cue, intent: 'delight', atMs: 2_500, transitionMs: 280 },
  ])
  assert.equal(continuous[1].transitionMs, 380)
  assert.equal(continuous[1].interrupt, 'queue')
  assert.equal(continuous[2].transitionMs, 240)
})

test('character energy continuously changes generated performance style', () => {
  const calm = planCompanionMotion({
    text: '我明白了。',
    state: { ...state, energy: 10 },
  })
  const lively = planCompanionMotion({
    text: '我明白了。',
    state: { ...state, energy: 95 },
  })
  assert.ok(lively.cues[0].intensity > calm.cues[0].intensity)
  assert.ok(lively.cues[0].tempo > calm.cues[0].tempo)
})

test('builds an immediate deterministic preview plan', () => {
  const plan = previewMotionPlan('greet', state)
  assert.equal(plan.source, 'preview')
  assert.equal(plan.cues[0].atMs, 0)
  assert.equal(plan.cues[0].interrupt, 'replace')
})

test('generates a state-aware three-phase motion phrase without fixed clips', () => {
  const first = generateMotionPhrase('thoughtful-reply', state, 9)
  const repeated = generateMotionPhrase('thoughtful-reply', state, 9)
  const next = generateMotionPhrase('thoughtful-reply', state, 10)
  assert.deepEqual(first, repeated)
  assert.equal(first.performanceId, undefined)
  assert.deepEqual(
    first.cues.map((cue) => cue.phase),
    ['anticipation', 'action', 'settle'],
  )
  assert.deepEqual(first.cues[0].preferredClipIds, [
    'observe',
    'listen',
    'thinking',
  ])
  assert.ok(
    first.cues.every(
      (cue, index) => index === 0 || cue.atMs > first.cues[index - 1].atMs,
    ),
  )
  assert.notEqual(first.cues[0].variationSeed, next.cues[0].variationSeed)
})

test('accepts bounded backend model plans and rejects unknown intents', () => {
  const plan = motionPlanFromMessageMeta({
    motionPlan: {
      cues: [
        {
          intent: 'delight',
          atMs: 180,
          intensity: 0.9,
          tempo: 1.1,
          fadeInMs: 120,
          fadeOutMs: 240,
          interrupt: 'queue',
        },
      ],
    },
  })
  assert.equal(plan?.cues[0].intent, 'delight')
  assert.equal(plan?.source, 'reply')
  assert.equal(
    motionPlanFromMessageMeta({
      motionPlan: { performanceId: 'discovery' },
    })?.performanceId,
    'discovery',
  )
  assert.equal(
    motionPlanFromMessageMeta({
      motionPlan: { cues: [{ intent: 'run-code' }] },
    }),
    null,
  )
})
