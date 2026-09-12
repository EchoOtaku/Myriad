import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PERSONA_DEFAULT_NAME,
  PERSONA_OFF_NAME,
  publicPersonaName,
  publicPersonaNameFromConfig,
  settingsAgentLabel,
} from './publicName'

test('public persona name matches the site face rule', () => {
  assert.equal(publicPersonaName(false, '瞳'), PERSONA_OFF_NAME)
  assert.equal(publicPersonaName(false, ''), PERSONA_OFF_NAME)
  assert.equal(publicPersonaName(true, '  瞳  '), '瞳')
  assert.equal(publicPersonaName(true, '   '), PERSONA_DEFAULT_NAME)
  assert.equal(publicPersonaName(true, null), PERSONA_DEFAULT_NAME)
})

test('public config name wins; otherwise fall back by meropeEnabled', () => {
  assert.equal(
    publicPersonaNameFromConfig({
      meropeEnabled: false,
      agentPersonaName: 'Agent',
    }),
    PERSONA_OFF_NAME,
  )
  assert.equal(
    publicPersonaNameFromConfig({
      meropeEnabled: true,
      agentPersonaName: '瞳',
    }),
    '瞳',
  )
  assert.equal(
    publicPersonaNameFromConfig({ meropeEnabled: false }),
    PERSONA_OFF_NAME,
  )
  assert.equal(
    publicPersonaNameFromConfig({ meropeEnabled: true }),
    PERSONA_DEFAULT_NAME,
  )
})

test('settings Agent label uses the character name once the public face has one', () => {
  assert.equal(settingsAgentLabel('Agent', PERSONA_OFF_NAME), 'Agent')
  assert.equal(settingsAgentLabel('Agent', '  Agent  '), 'Agent')
  assert.equal(settingsAgentLabel('Agent', ''), 'Agent')
  assert.equal(settingsAgentLabel('Agent', PERSONA_DEFAULT_NAME), PERSONA_DEFAULT_NAME)
  assert.equal(settingsAgentLabel('Agent', '  瞳  '), '瞳')
})

test('settings nav and search follow the public persona name', () => {
  const nav = readFileSync(
    new URL('../../components/config/form/useConfigNavigation.tsx', import.meta.url),
    'utf8',
  )
  const search = readFileSync(
    new URL('../../components/config/form/useConfigSearch.ts', import.meta.url),
    'utf8',
  )
  assert.match(nav, /settingsAgentLabel\(t\.config\.agent, personaName\)/)
  assert.match(nav, /label: agentLabel/)
  assert.match(search, /settingsAgentLabel\(t\.config\.agent, personaName\)/)
  assert.match(search, /agentTitle/)
})
