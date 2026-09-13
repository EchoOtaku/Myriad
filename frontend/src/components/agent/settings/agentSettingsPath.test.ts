import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_SETTINGS_PATH,
  agentSettingsPath,
  agentSettingsRedirectFromSearch,
  isAgentSettingsPath,
} from './agentSettingsPath.ts'

describe('agentSettingsPath', () => {
  it('keeps the product home at /agent/settings', () => {
    assert.equal(agentSettingsPath(), AGENT_SETTINGS_PATH)
    assert.equal(isAgentSettingsPath('/agent/settings'), true)
    assert.equal(isAgentSettingsPath('/agent/settings/'), true)
    assert.equal(isAgentSettingsPath('/config'), false)
  })

  it('carries persona subpages and guide deep links', () => {
    assert.equal(
      agentSettingsPath({ page: 'merope' }),
      '/agent/settings?page=merope',
    )
    assert.equal(
      agentSettingsPath({ page: 'merope-setup', guidePath: 'agent.agentPersona' }),
      '/agent/settings?page=merope-setup&guide=agent.agentPersona',
    )
    assert.equal(agentSettingsPath({ page: 'ignored' }), AGENT_SETTINGS_PATH)
  })
})

describe('agentSettingsRedirectFromSearch', () => {
  it('moves the old admin-console Agent room onto the Agent page', () => {
    assert.equal(
      agentSettingsRedirectFromSearch('section=agent'),
      '/agent/settings',
    )
    assert.equal(
      agentSettingsRedirectFromSearch('?section=agent&guide=agent.channels'),
      '/agent/settings?guide=agent.channels',
    )
    assert.equal(
      agentSettingsRedirectFromSearch('section=ai&page=merope'),
      '/agent/settings?page=merope',
    )
    assert.equal(
      agentSettingsRedirectFromSearch('page=merope-setup'),
      '/agent/settings?page=merope-setup',
    )
    assert.equal(agentSettingsRedirectFromSearch('section=ai'), null)
    assert.equal(agentSettingsRedirectFromSearch(''), null)
  })
})
