import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { it } from 'node:test'
import React, { Suspense } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { I18nProvider, useConfigI18n } from './I18nContext'

it('starts the initial locale fetch before mounting the provider', () => {
  const source = readFileSync(new URL('./I18nContext.tsx', import.meta.url), 'utf8')
  const beforeProvider = source.slice(0, source.indexOf('export const I18nProvider'))
  assert.match(beforeProvider, /typeof window !== 'undefined'/)
  assert.match(beforeProvider, /loadShellLocale\(getDefaultLocale\(\)\)/)
})

it('renders a complete settings catalog in a detached React tree and provider', async () => {
  function SettingsLabel() {
    const { t } = useConfigI18n()
    return <span>{t.config.title}</span>
  }
  const output = new PassThrough()
  let html = ''
  output.on('data', chunk => { html += chunk.toString() })
  await new Promise<void>((resolve, reject) => {
    output.on('end', resolve)
    output.on('error', reject)
    const stream = renderToPipeableStream(
      <Suspense fallback={<span>Loading</span>}><SettingsLabel /></Suspense>,
      {
        onAllReady() { stream.pipe(output) },
        onError: reject,
      },
    )
  })
  assert.match(html, /System Configuration/)

  const providerOutput = new PassThrough()
  let providerHtml = ''
  providerOutput.on('data', chunk => { providerHtml += chunk.toString() })
  await new Promise<void>((resolve, reject) => {
    providerOutput.on('end', resolve)
    const stream = renderToPipeableStream(<I18nProvider><SettingsLabel /></I18nProvider>, {
      onAllReady() { stream.pipe(providerOutput) },
      onError: reject,
    })
  })
  assert.match(providerHtml, /System Configuration/)
})
