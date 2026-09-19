import type { QuoteData, WeatherData } from '../../../src/utils/dynamicContent'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { builtinIslandResources } from '../../../src/components/ControlPanel/builtinIslandResources'
import { useBuiltinIslandContents } from '../../../src/components/ControlPanel/useBuiltinIslandContents'
import { I18nProvider, useI18n } from '../../../src/contexts/I18nContext'
import { useVisibleState } from '../../../src/hooks/useVisibleState'
import { dynamicContentProvider } from '../../../src/services/DynamicContentProvider'

const weatherPending: Array<(value: WeatherData | null) => void> = []
const quotesPending = new Map<string, Array<(value: QuoteData | null) => void>>()
let weatherRequests = 0
const quoteRequests: string[] = []
builtinIslandResources.weather = () => {
  weatherRequests++
  return new Promise(resolve => weatherPending.push(resolve))
}
builtinIslandResources.quote = locale => {
  const key = locale ?? 'en-US'
  quoteRequests.push(key)
  return new Promise(resolve => {
    const list = quotesPending.get(key) ?? []
    list.push(resolve)
    quotesPending.set(key, list)
  })
}
function Contents() {
  const { locale, t } = useI18n()
  const contents = useBuiltinIslandContents('Fixture', locale, t)
  return <>{contents.map(content => <output key={content.type} data-content={content.type}>{content.text}</output>)}</>
}
function Probe() {
  const [mounted, setMounted] = useState(true)
  const { locale, setLocale } = useI18n()
  const [count, setCount] = useVisibleState(0)
  return <>
    <button onClick={() => setLocale('ja-JP', { persist: false })}>Japanese</button>
    <button onClick={() => setMounted(value => !value)}>Toggle mount</button>
    <button onClick={() => { for (let i = 0; i < 100; i++) setCount(value => value + 1) }}>Many updates</button>
    <output data-locale>{locale}</output><output data-visible-count>{count}</output>
    {mounted && <Contents />}
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider><Probe /></I18nProvider></StrictMode>)
Object.assign(window, { builtinIslandFixture: {
  stats: () => ({ weatherRequests, quoteRequests }),
  weather: () => {
    const callbacks = weatherPending.splice(0)
    for (const callback of callbacks) callback({ city: 'Tokyo', temperature: '20°C', weatherCode: 0, icon: '/sun.webp', weather: 'sunny' } as WeatherData)
  },
  quote: (locale: string, text: string) => {
    const callbacks = quotesPending.get(locale) ?? []
    quotesPending.delete(locale)
    for (const callback of callbacks) callback({ text, author: 'Fixture' })
  },
  provider: dynamicContentProvider,
} })
