import type { AgentMessageStep } from './agentThinking'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatStepDuration,
  stepsWorthShowing,
  summarizeAgentSteps,
} from './agentThinking'

function step(overrides: Partial<AgentMessageStep> = {}): AgentMessageStep {
  return {
  id: 's1',
  name: '查天气',
  status: 'done',
  ...overrides,
}
}

test('报出卡在哪一步、跑完几步、一共多久', () => {
  const summary = summarizeAgentSteps([
    step({ id: 's1', status: 'done', durationMs: 400 }),
    step({ id: 's2', name: '整理结果', status: 'running' }),
    step({ id: 's3', name: '写回复', status: 'pending' }),
  ])
  assert.deepEqual(summary, {
    running: '整理结果',
    done: 1,
    total: 3,
    elapsedMs: 400,
    failed: false,
  })
})

test('全跑完之后没有「正在跑」的那一步', () => {
  const summary = summarizeAgentSteps([
    step({ id: 's1', status: 'done', durationMs: 400 }),
    step({ id: 's2', status: 'done', durationMs: 1_100 }),
  ])
  assert.equal(summary.running, null)
  assert.equal(summary.done, 2)
  assert.equal(summary.elapsedMs, 1_500)
})

test('失败的那步也算跑完，但要把失败标出来', () => {
  const summary = summarizeAgentSteps([
    step({ id: 's1', status: 'done', durationMs: 100 }),
    step({ id: 's2', status: 'error', durationMs: 50 }),
  ])
  assert.equal(summary.done, 2)
  assert.equal(summary.failed, true)
})

test('一步都没报过时长就不显示时长 —— 0.0s 看着像瞬间完成，其实是没数据', () => {
  const summary = summarizeAgentSteps([
    step({ status: 'running', durationMs: undefined }),
  ])
  assert.equal(summary.elapsedMs, null)
})

test('没有步骤时不炸，也不编数字', () => {
  assert.deepEqual(summarizeAgentSteps([]), {
    running: null,
    done: 0,
    total: 0,
    elapsedMs: null,
    failed: false,
  })
})

test('只有一步且已经跑完就不摆过程 —— 正文本身就是结果', () => {
  assert.equal(stepsWorthShowing([]), false)
  assert.equal(stepsWorthShowing([step({ status: 'done' })]), false)
  // 但还在跑的时候要说一声，否则等待期间界面上什么都没有
  assert.equal(stepsWorthShowing([step({ status: 'running' })]), true)
  // 失败的单步更要摆出来 —— 哪一步炸的比「失败了」这个结论有用
  assert.equal(stepsWorthShowing([step({ status: 'error' })]), true)
  assert.equal(
    stepsWorthShowing([step({ id: 's1' }), step({ id: 's2' })]),
    true,
  )
})

test('时长按量级换单位，不出现 0.4s 和 83.0s 这种读法', () => {
  assert.equal(formatStepDuration(400), '400ms')
  assert.equal(formatStepDuration(1_500), '1.5s')
  assert.equal(formatStepDuration(59_400), '59.4s')
  assert.equal(formatStepDuration(83_000), '1m23s')
  assert.equal(formatStepDuration(600_000), '10m00s')
})
