import type { PerformanceDirective } from '../../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cueOccupiesHeadBody,
  performanceOccupiedChannels,
} from './performanceChannels'

function directive(
  overrides: Partial<PerformanceDirective['plan']> = {},
): PerformanceDirective {
  return {
    phase: 'delivery',
    moodRevision: 1,
    plan: {
      baseline: {
        expression: 'warm',
        posture: 'neutral',
        motionEnergy: 1,
        attention: 1,
      },
      cues: [],
      ...overrides,
    },
  }
}

test('think does not occupy head/body; greet does', () => {
  assert.equal(
    cueOccupiesHeadBody({
      intent: 'think',
      atMs: 0,
      intensity: 1,
      tempo: 1,
      fadeInMs: 80,
      fadeOutMs: 120,
      interrupt: 'replace',
    }),
    false,
  )
  assert.equal(
    cueOccupiesHeadBody({
      intent: 'greet',
      atMs: 0,
      intensity: 1,
      tempo: 1,
      fadeInMs: 80,
      fadeOutMs: 120,
      interrupt: 'replace',
    }),
    true,
  )
})

test('a face-only plan does not take the singing body', () => {
  const channels = performanceOccupiedChannels(
    directive({
      cues: [
        {
          intent: 'think',
          atMs: 0,
          intensity: 1,
          tempo: 1,
          fadeInMs: 80,
          fadeOutMs: 120,
          interrupt: 'replace',
        },
      ],
    }),
  )
  assert.deepEqual(channels, ['expression'])
})

test('posture and body cues claim head/body without taking the mouth', () => {
  const channels = performanceOccupiedChannels(
    directive({
      baseline: {
        expression: 'warm',
        posture: 'open',
        motionEnergy: 1,
        attention: 1,
      },
      cues: [
        {
          intent: 'greet',
          atMs: 0,
          intensity: 1,
          tempo: 1,
          fadeInMs: 80,
          fadeOutMs: 120,
          interrupt: 'replace',
        },
      ],
    }),
  )
  assert.ok(channels.includes('expression'))
  assert.ok(channels.includes('headBody'))
  assert.equal(channels.includes('mouth'), false)
})
