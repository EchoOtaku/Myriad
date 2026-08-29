import type { ChatMessage } from './engineTypes'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getAgentMessagesSnapshot, setAgentMessages } from './agentMessages'
import {
  projectAgentMessage,
  syncProjectedMessages,
} from './projectAgentMessage'

function chat(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a',
    sessionId: 's',
    role: 'assistant',
    content: '你好',
    createdAt: new Date(1_700_000_000_000),
    ...overrides,
  }
}

afterEach(() => {
  setAgentMessages([])
})

test('投影只留下界面要的字段', () => {
  const projected = projectAgentMessage(
    chat({
      content: '在说',
      taskExecution: {
        taskId: 't',
        status: 'processing',
        progress: 10,
        steps: [
          {
            id: 'step-1',
            name: '读',
            status: 'running',
            durationMs: 12,
            message: '还在',
          },
        ],
      },
    }),
  )
  assert.equal(projected.state, 'streaming')
  assert.equal(projected.steps?.[0]?.status, 'running')
  assert.equal(projected.steps?.[0]?.note, '还在')
  assert.equal(projected.at, 1_700_000_000_000)
})

test('流式时只投影最后一条，前面的对象沿用', () => {
  syncProjectedMessages([
    chat({ id: 'u', role: 'user', content: '问' }),
    chat({ id: 'a', content: '答' }),
  ])
  const snap = getAgentMessagesSnapshot()
  syncProjectedMessages([
    chat({ id: 'u', role: 'user', content: '问' }),
    chat({ id: 'a', content: '答呀' }),
  ])
  const next = getAgentMessagesSnapshot()
  assert.equal(next[0], snap[0])
  assert.equal(next[1]?.content, '答呀')
  assert.notEqual(next[1], snap[1])
})
