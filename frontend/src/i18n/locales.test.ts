import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  htmlLang,
  isLocale,
  parseLocale,
  parseLocaleCookie,
} from './locales.ts'

describe('parseLocale', () => {
  it('accepts exact host tags', () => {
    assert.equal(parseLocale('zh-CN'), 'zh-CN')
    assert.equal(parseLocale('zh-TW'), 'zh-TW')
    assert.equal(parseLocale('en-US'), 'en-US')
    assert.equal(parseLocale('ja-JP'), 'ja-JP')
  })

  it('maps Traditional Chinese tags to zh-TW', () => {
    assert.equal(parseLocale('zh-HK'), 'zh-TW')
    assert.equal(parseLocale('zh-MO'), 'zh-TW')
    assert.equal(parseLocale('zh-Hant'), 'zh-TW')
  })

  it('maps other Chinese tags to zh-CN', () => {
    assert.equal(parseLocale('zh'), 'zh-CN')
    assert.equal(parseLocale('zh-Hans'), 'zh-CN')
  })

  it('rejects unknown values', () => {
    assert.equal(parseLocale('fr-FR'), null)
    assert.equal(parseLocale(''), null)
    assert.equal(isLocale('zh-HK'), false)
  })

  it('honors Accept-Language quality values', () => {
    assert.equal(parseLocale('fr, zh-TW;q=0.9'), 'zh-TW')
    assert.equal(parseLocale('en-US,zh-TW;q=0.8'), 'en-US')
    assert.equal(parseLocale('zh-HK,en;q=0.4'), 'zh-TW')
    assert.equal(parseLocale('de;q=0.8,ja-JP;q=0.2'), 'ja-JP')
    assert.equal(parseLocale('fr;q=1,en;q=0'), null)
  })

  it('uses a short html lang for English', () => {
    assert.equal(htmlLang('en-US'), 'en')
    assert.equal(htmlLang('zh-TW'), 'zh-TW')
  })
})

describe('parseLocaleCookie', () => {
  it('reads the locale cookie among other cookies', () => {
    assert.equal(parseLocaleCookie('theme=dark; locale=zh-TW; sid=1'), 'zh-TW')
    assert.equal(parseLocaleCookie('locale=en-US'), 'en-US')
    assert.equal(parseLocaleCookie('theme=dark'), null)
  })
})
