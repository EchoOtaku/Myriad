import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('persona.get guest contract', () => {
  it('skips /api/agent/persona when the host already knows the viewer is a guest', () => {
    const src = readFileSync(new URL('./personaHandlers.ts', import.meta.url), 'utf8')
    const guestAt = src.indexOf('isKnownGuest()')
    const personaAt = src.indexOf('agentService.getPersona()')
    assert.ok(guestAt >= 0, 'known-guest short-circuit')
    assert.ok(personaAt > guestAt, 'getPersona must stay behind isKnownGuest')
  })
})
