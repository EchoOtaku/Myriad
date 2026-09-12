import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCALES } from '../../i18n'
import {
  initialVirtual,
  localeAtVirtual,
  LOOP_ITEMS,
  LOOP_LAST,
  needsSnap,
  snapVirtual,
  stripTransform,
} from './languageSwitchModel'

describe('languageSwitchModel', () => {
  it('centers the current locale on the middle copy', () => {
    assert.equal(LOOP_ITEMS[initialVirtual('ja-JP')], 'ja-JP')
    assert.equal(LOOP_ITEMS[initialVirtual('zh-CN')], 'zh-CN')
    assert.equal(LOOP_ITEMS[initialVirtual('de-DE')], 'de-DE')
  })

  it('wraps past the last item onto the first locale', () => {
    assert.equal(localeAtVirtual(LOOP_LAST), LOCALES[0])
    assert.equal(needsSnap(LOOP_LAST), true)
    assert.equal(LOOP_ITEMS[snapVirtual(LOOP_LAST)], LOCALES[0])
  })

  it('wraps before the first item onto the last locale', () => {
    assert.equal(localeAtVirtual(0), LOCALES[LOCALES.length - 1])
    assert.equal(needsSnap(0), true)
    assert.equal(LOOP_ITEMS[snapVirtual(0)], LOCALES[LOCALES.length - 1])
  })

  it('writes a compositor transform without CSS variables', () => {
    assert.equal(
      stripTransform(initialVirtual('ja-JP'), 0),
      'translate3d(calc(0px - 11.275rem), -50%, 0)',
    )
  })
})
