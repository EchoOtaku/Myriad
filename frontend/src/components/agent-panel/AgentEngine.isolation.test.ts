import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Work interrupt cannot abort Chat SSE, and session ids stay per mode', () => {
  const engine = readFileSync(new URL('./AgentEngine.tsx', import.meta.url), 'utf8')
  assert.match(engine, /abortCurrentRequest\(current\)/)
  assert.match(engine, /findMessageWhere/)
  assert.match(engine, /setSessionId\(event\.sessionId, mode\)/)
  assert.match(engine, /loadingByModeRef\.current\.work \|\| loadingByModeRef\.current\.chat/)
  assert.match(engine, /restorePendingActionFromMessages/)
  assert.match(engine, /pendingQuestionFromMetadata/)

  const api = readFileSync(
    new URL('../../services/agent/agentApi.ts', import.meta.url),
    'utf8',
  )
  assert.match(api, /activeAbortControllersByMode/)
  assert.match(api, /context\?\.mode === 'chat' \? 'chat' : 'work'/)
  assert.match(api, /lane === 'chat'/)
  assert.match(engine, /chatTurnClockRef/)
  assert.match(engine, /isStreamSupersededError/)
  assert.match(engine, /isUserInterruptError/)
  assert.match(engine, /isCurrentChatGeneration/)
  assert.match(engine, /setLiveMotionGeneration/)
  assert.match(engine, /agentFace.setGeneration/)
  assert.match(engine, /cancelChatTurn/)
  assert.match(engine, /alreadyFed/)
  assert.doesNotMatch(engine, /if \(mode === 'chat'\) return/)
  assert.match(engine, /mode !== 'chat'/)
})
