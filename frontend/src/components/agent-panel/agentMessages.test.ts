import type { AgentMessage } from './agentMessages'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  clearAgentMessages,
  getAgentMessagesSnapshot,
  setAgentMessages,
  subscribeAgentMessages,
} from './agentMessages'

function message(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
  id: 'm1',
  role: 'assistant',
  content: '你好',
  ...overrides,
}
}

afterEach(() => {
  clearAgentMessages()
})

test('换了内容才叫醒订阅者', () => {
  let notifications = 0
  const unsubscribe = subscribeAgentMessages(() => {
    notifications += 1
  })

  setAgentMessages([message()])
  assert.equal(notifications, 1)

  // 流式回复每个 token 都会重建数组，逐条比过才不会白重渲染
  setAgentMessages([message()])
  assert.equal(notifications, 1)

  setAgentMessages([message({ content: '你好呀' })])
  assert.equal(notifications, 2)

  unsubscribe()
  setAgentMessages([message({ content: '再改一次' })])
  assert.equal(notifications, 2)
})

test('条数、角色、状态、图片数量任一变了都算变了', () => {
  const base = [message()]
  setAgentMessages(base)
  const snapshot = getAgentMessagesSnapshot()

  setAgentMessages([message({ role: 'user' })])
  assert.notEqual(getAgentMessagesSnapshot(), snapshot)

  setAgentMessages([message()])
  setAgentMessages([message({ state: 'streaming' })])
  assert.equal(getAgentMessagesSnapshot()[0].state, 'streaming')

  setAgentMessages([message()])
  setAgentMessages([message({ imageUrls: ['/a.png'] })])
  assert.equal(getAgentMessagesSnapshot()[0].imageUrls?.length, 1)

  setAgentMessages([message(), message({ id: 'm2' })])
  assert.equal(getAgentMessagesSnapshot().length, 2)
})

test('清空之后拿到的是同一个空数组，引用稳定', () => {
  setAgentMessages([message()])
  clearAgentMessages()
  const first = getAgentMessagesSnapshot()
  clearAgentMessages()
  assert.equal(getAgentMessagesSnapshot(), first)
  assert.equal(first.length, 0)
})
