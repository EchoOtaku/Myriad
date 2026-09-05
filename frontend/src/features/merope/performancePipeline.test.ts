import type { PerformanceDirective } from '../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentFaceChannel } from './agentFaceChannel'
import { RigMotionCoordinator } from './motion/coordinator'
import { MotionRuntime } from './motion/runtime'
import { meropePerformanceEventDetail } from './performanceEvents'

const delivery: PerformanceDirective = {
  phase: 'delivery',
  moodRevision: 10,
  motionStyle: 'even',
  plan: {
    baseline: {
      expression: 'steady',
      posture: 'neutral',
      motionEnergy: 1,
      attention: 1,
    },
    cues: [
      {
        intent: 'respond',
        atMs: 0,
        intensity: 1,
        tempo: 1,
        fadeInMs: 100,
        fadeOutMs: 400,
        interrupt: 'if-lower',
      },
    ],
  },
}

function pipeline(runtime: MotionRuntime) {
  return new AgentFaceChannel({
    performance: (value) => {
      const event = meropePerformanceEventDetail(value)
      if (event) runtime.performance.handle(event)
    },
    speech: (event) => runtime.performance.handleSpeech(event),
    utterance: () => undefined,
    state: () => undefined,
  })
}

test('channel → event validation → lifecycle → scheduler preserves a delivery beat at landing', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  const channel = pipeline(runtime)
  try {
    channel.deliver({ messageId: 'reply', performance: delivery })
    const before = runtime.frame().performance!
    assert.ok(
      before.behaviorPlan?.behaviors.some(
        (behavior) => behavior.form.id === 'respond',
      ),
    )
    channel.deliver({
      messageId: 'reply',
      performance: { ...delivery, plan: { ...delivery.plan, cues: [] } },
    })
    const after = runtime.frame().performance!
    assert.equal(after.motionIntentId, before.motionIntentId)
    assert.equal(after.startedAtMs, before.startedAtMs)
    assert.equal(after.behaviorPlan, before.behaviorPlan)
    assert.equal(after.directive?.plan.cues.length, 0)
  } finally {
    release()
  }
})

test('same-size model refinement reaches the scheduler; replay after speech end cannot roll it back', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  const channel = pipeline(runtime)
  try {
    channel.deliver({ messageId: 'reply', performance: delivery })
    const refined: PerformanceDirective = {
      ...delivery,
      plan: {
        baseline: { ...delivery.plan.baseline!, expression: 'warm' },
        cues: [
          {
            ...delivery.plan.cues[0]!,
            intent: 'delight',
            interrupt: 'replace',
          },
        ],
      },
    }
    channel.deliver({ messageId: 'reply', performance: refined })
    const before = runtime.frame()
    assert.equal(before.bearing?.expression, 'warm')
    assert.ok(
      before.behaviors.some((behavior) => behavior.form.id === 'delight'),
    )
    assert.ok(
      before.behaviors.some(
        (behavior) =>
          behavior.form.id === 'respond' && behavior.phase === 'recovering',
      ),
    )
    const speech = channel.openReply('reply')
    speech.chunk('a completed spoken reply')
    speech.end()
    // deliver() assigns a new transport intent id to this replay.
    channel.deliver({ messageId: 'reply', performance: delivery })
    const after = runtime.frame()
    assert.equal(after.bearing?.expression, 'warm')
    assert.equal(
      after.performance?.motionIntentId,
      before.performance?.motionIntentId,
    )
    assert.equal(
      after.performance?.behaviorPlan,
      before.performance?.behaviorPlan,
    )
  } finally {
    release()
  }
})
