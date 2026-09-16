import React, { Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useConfigI18n, useI18n } from '../../../src/contexts/I18nContext'

function Settings() {
  const { t, locale } = useConfigI18n()
  const [saved, setSaved] = useState('')
  return <section data-testid="settings" data-locale={locale}>
    <h1>{t.config.title}</h1>
    <button onClick={() => setSaved(t.config.title)}>Read settings copy</button>
    <output data-testid="event-copy">{saved}</output>
  </section>
}

function App() {
  const { t, locale, setLocale } = useI18n()
  const [settings, showSettings] = useState(false)
  return <>
    <output data-testid="shell" data-locale={locale}>{t.common.loading}</output>
    <button onClick={() => showSettings(value => !value)}>Toggle settings</button>
    {(['en-US', 'ja-JP', 'de-DE'] as const).map(value =>
      <button key={value} onClick={() => setLocale(value, { persist: false })}>{value}</button>,
    )}
    <Suspense fallback={<p data-testid="settings-loading">Loading settings</p>}>
      {settings && <Settings />}
    </Suspense>
  </>
}

createRoot(document.getElementById('root')!).render(<I18nProvider><App /></I18nProvider>)
