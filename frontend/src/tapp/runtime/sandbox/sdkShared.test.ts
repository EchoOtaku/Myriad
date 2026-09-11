import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  generateKvNamespaceCode,
  generateSettingsNamespaceCode,
  SDK_FREEZE_TAPP_CODE,
} from './sdkShared.ts'

describe('generateKvNamespaceCode', () => {
  it('keeps storage/shared/private on the same method surface', () => {
    for (const api of ['storage', 'shared', 'private'] as const) {
      const arrow = generateKvNamespaceCode(api, 'arrow')
      const fn = generateKvNamespaceCode(api, 'fn')
      for (const source of [arrow, fn]) {
        assert.match(source, new RegExp(`${api}:\\s*\\{`))
        for (const method of [
          'get',
          'set',
          'remove',
          'keys',
          'getAll',
          'clear',
          'usage',
        ]) {
          assert.match(
            source,
            new RegExp(`sendRequest\\('${api}', '${method}'`),
          )
        }
        assert.match(
          source,
          new RegExp(`addEventListener\\('${api}Changed'`),
        )
      }
      assert.match(arrow, /get:\s*\(k\)\s*=>/)
      assert.match(fn, /get:\s*function\(k\)/)
    }
  })
})

describe('generateSettingsNamespaceCode', () => {
  it('is a declared-key subset with onChanged', () => {
    const source = generateSettingsNamespaceCode('arrow')
    assert.match(source, /settings:\s*\{/)
    assert.match(source, /sendRequest\('settings', 'get'/)
    assert.match(source, /sendRequest\('settings', 'set'/)
    assert.match(source, /sendRequest\('settings', 'getAll'/)
    assert.match(source, /addEventListener\('settingsChanged'/)
    assert.doesNotMatch(source, /sendRequest\('settings', 'remove'/)
    assert.doesNotMatch(source, /sendRequest\('settings', 'clear'/)
    assert.doesNotMatch(source, /sendRequest\('settings', 'keys'/)
  })
})

describe('SDK_FREEZE_TAPP_CODE', () => {
  it('freezes window.Tapp and skips widgets/pages', () => {
    assert.match(SDK_FREEZE_TAPP_CODE, /skip = \{ widgets: 1, pages: 1 \}/)
    assert.match(SDK_FREEZE_TAPP_CODE, /\)\(window\.Tapp\)/)
    assert.doesNotMatch(SDK_FREEZE_TAPP_CODE, /\)\(Tapp\)/)
  })
})
