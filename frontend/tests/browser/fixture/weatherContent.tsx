import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useWeatherContent } from '../../../src/components/widgets/useWeatherContent'
import { I18nProvider, useI18n } from '../../../src/contexts/I18nContext'

let cacheReads = 0
const read = Storage.prototype.getItem
Storage.prototype.getItem = function (key: string) {
  if (key === 'weather_data_cache') cacheReads++
  return read.call(this, key)
}
let complete: ((response: Response) => void) | null = null
window.fetch = async (input) => {
  const url = String(input)
  if (url.includes('/v1/forecast')) return new Promise<Response>(resolve => { complete = resolve })
  if (url.includes('/client-geo')) return Response.json({ status: 'success', lat: 35, lon: 139, city: 'Tokyo' })
  return Response.json({ precise_location_enabled: false })
}
Object.assign(window, { weatherContentFixture: {
  reads: () => cacheReads,
  pending: () => Boolean(complete),
  finish: () => complete?.(Response.json({ current: { temperature_2m: 19, weather_code: 0, apparent_temperature: 19 } })),
} })
function Consumer({ preview }: { preview: boolean }) {
  const { weatherData, loading } = useWeatherContent(preview)
  return <output>{loading ? 'loading' : weatherData?.temperature}</output>
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  const [preview, setPreview] = useState(false)
  const { locale, setLocale } = useI18n()
  return <><button onClick={() => setMounted(value => !value)}>Toggle</button><button onClick={() => setPreview(true)}>Preview</button><button onClick={() => setLocale('ja-JP', { persist: false })}>Japanese</button><span data-locale>{locale}</span>{mounted && <Consumer preview={preview} />}</>
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture /></I18nProvider>)
