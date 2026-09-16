import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { it } from 'node:test'
import { createLocaleLoader } from './createLocaleLoader'
import * as localeLoader from './loadLocale'
import { copyForLocale } from './localeCopy'

it('loads translated shell service copy without loading the settings catalog', async () => {
  assert.equal(typeof localeLoader.loadShellLocale, 'function')
  const unavailableSettings = registerHooks({
    load(url, context, next) {
      if (url.endsWith('/config.ja-JP.json')) throw new Error('Settings chunk unavailable')
      return next(url, context)
    },
  })
  const shell = await localeLoader.loadShellLocale('ja-JP').finally(() => unavailableSettings.deregister())
  assert.equal(shell.common.loading, '読み込み中...')
  assert.equal(typeof shell.config.loadConfigFailed, 'string')
  assert.equal(typeof shell.config.poweredBy, 'string')
  assert.equal(localeLoader.getCachedLocale('ja-JP'), null)
  assert.equal(copyForLocale('ja-JP').config.loadConfigFailed, shell.config.loadConfigFailed)
  const full = await localeLoader.loadLocale('ja-JP')
  assert.equal(full.common, shell.common)
  assert.equal(typeof full.config.title, 'string')
  assert.equal(full.config.loadConfigFailed, shell.config.loadConfigFailed)
})

it('suspends once, surfaces failed imports, and allows an explicit retry', async () => {
  let fail = true
  const failure = new Error('offline')
  const importer = async () => {
    if (fail) throw failure
    return { label: 'Loaded' }
  }
  const loader = createLocaleLoader({
    'en-US': importer, 'zh-CN': importer, 'zh-TW': importer,
    'ja-JP': importer, 'ko-KR': importer, 'fr-FR': importer, 'de-DE': importer,
  })
  assert.equal(typeof loader.read, 'function')
  let pending: unknown
  try { loader.read('en-US') } catch (error) { pending = error }
  assert.ok(pending instanceof Promise)
  assert.throws(() => loader.read('en-US'), error => error === pending)
  await assert.rejects(pending, error => error === failure)
  assert.throws(() => loader.read('en-US'), error => error === failure)
  fail = false
  await loader.load('en-US')
  assert.equal(loader.read('en-US').label, 'Loaded')
})

it('keeps the small shell settings copy identical to all seven full catalogs', () => {
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE']) {
    const full = JSON.parse(readFileSync(new URL(`./config.${locale}.json`, import.meta.url), 'utf8'))
    const shell = JSON.parse(readFileSync(new URL(`./configService.${locale}.json`, import.meta.url), 'utf8'))
    for (const [key, value] of Object.entries(shell)) {
      if (typeof value === 'object' && value !== null) {
        for (const [child, text] of Object.entries(value)) assert.equal(text, full[key][child], `${locale}: ${key}.${child}`)
      } else { assert.equal(value, full[key], `${locale}: ${key}`)
}
    }
  }
})
