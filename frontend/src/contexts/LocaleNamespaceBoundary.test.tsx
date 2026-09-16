import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import React, { act, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createLocaleLoader } from '../i18n/createLocaleLoader'
import * as localeModule from '../i18n/loadLocale'
import * as contextModule from './I18nContext'

it('shows translated namespace failure and retries without swallowing unrelated errors', async () => {
  assert.equal(typeof contextModule.LocaleNamespaceBoundary, 'function')
  const require = createRequire(import.meta.url)
  const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
  const dom = new JSDOM('<div id="root"></div>')
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const root = createRoot(dom.window.document.getElementById('root')!)
  const shell = await localeModule.loadShellLocale('ja-JP')
  let fail = true
  const importer = async () => {
    if (fail) throw new localeModule.LocaleNamespaceError('ja-JP', new Error('offline'))
    return { label: '設定を読み込みました' }
  }
  const loader = createLocaleLoader({
    'en-US': importer, 'zh-CN': importer, 'zh-TW': importer, 'ja-JP': importer,
    'ko-KR': importer, 'fr-FR': importer, 'de-DE': importer,
  })
  function Settings() { return <span>{loader.read('ja-JP').label}</span> }
  const Boundary = contextModule.LocaleNamespaceBoundary
  const originalError = console.error
  console.error = () => {}
  try {
    await act(async () => {
      root.render(
        <Boundary locale="ja-JP" copy={shell} retry={() => loader.load('ja-JP')}>
          <Suspense fallback={null}><Settings /></Suspense>
        </Boundary>,
      )
    })
    assert.match(dom.window.document.body.textContent!, new RegExp(shell.errors.localeLoadFailed))
    const retry = dom.window.document.querySelector('button')!
    assert.equal(retry.textContent, shell.common.retry)
    fail = false
    await act(async () => { retry.click() })
    assert.match(dom.window.document.body.textContent!, /設定を読み込みました/)
    const unrelated = new Error('unrelated')
    assert.throws(() => Boundary.getDerivedStateFromError(unrelated), error => error === unrelated)
  } finally {
    await act(async () => root.unmount())
    console.error = originalError
    Object.assign(globalThis, { window: originalWindow, document: originalDocument })
    dom.window.close()
  }
})
