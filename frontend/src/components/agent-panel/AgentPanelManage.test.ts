import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { applyAutonomyToggle } from './AgentPanelManage'

test('manage toggle calls put when enabling and revoke when disabling', async () => {
  const calls: string[] = []
  const service = {
    putAutonomyGrant: async () => {
      calls.push('put')
    },
    revokeAutonomyGrant: async () => {
      calls.push('revoke')
    },
  }
  await applyAutonomyToggle(true, service)
  await applyAutonomyToggle(false, service)
  assert.deepEqual(calls, ['put', 'revoke'])
})

test('manage panel wires the shipped autonomy API', () => {
  const source = readFileSync(new URL('./AgentPanelManage.tsx', import.meta.url), 'utf8')
  assert.match(source, /getAutonomyGrant/)
  assert.match(source, /applyAutonomyToggle/)
  assert.match(source, /autonomyAllow/)
})
