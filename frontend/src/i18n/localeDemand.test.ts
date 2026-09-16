import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createLocaleLoader } from './createLocaleLoader'
import * as localeLoader from './loadLocale'

it('loads translated shell service copy without loading the settings catalog', async () => {
  assert.equal(typeof localeLoader.loadShellLocale, 'function')
  const shell = await localeLoader.loadShellLocale('ja-JP')
  assert.equal(shell.common.loading, '読み込み中...')
  assert.equal(typeof shell.config.loadConfigFailed, 'string')
  assert.equal(typeof shell.config.poweredBy, 'string')
  assert.equal(localeLoader.getCachedLocale('ja-JP'), null)
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
