import type { TranslationKeys } from '../../i18n'
import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_WIDGET_BASE_CONFIG, getBuiltinWidgets } from './builtinWidgets'

const widgetsI18n = {
  agentPersona: 'Agent Persona',
} as TranslationKeys['widgets']

test('agent persona widget is fixed to 4x4', () => {
  const config = BUILTIN_WIDGET_BASE_CONFIG['agent-persona']
  assert.equal(config.defaultSize, '4x4')
  assert.deepEqual(config.supportedSizes, ['4x4'])
})

test('agent persona widget is available on Home only', () => {
  const homeIds = getBuiltinWidgets(widgetsI18n, 'home').map(({ id }) => id)
  const controlPanelIds = getBuiltinWidgets(widgetsI18n, 'control-panel').map(
    ({ id }) => id,
  )

  assert.ok(homeIds.includes('agent-persona'))
  assert.ok(!controlPanelIds.includes('agent-persona'))
})
