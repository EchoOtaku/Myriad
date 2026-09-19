import type { ShellTranslationKeys } from '../../i18n'
import type { DynamicContentItem } from '../../services/DynamicContentProvider'
import type { QuoteData, WeatherData } from '../../utils/dynamicContent'
import { getGreeting, WEATHER_ICON_ASSETS } from '../../utils/dynamicContent'

export const ISLAND_ASSETS = {
  quote: '/icons/dynamic/quote.webp',
  music: '/icons/dynamic/music.webp',
  musicPaused: '/icons/dynamic/music-paused.webp',
} as const

const GREETING_ASSETS: Record<string, string> = {
  sunrise: '/icons/greeting/sunrise.webp',
  sun: WEATHER_ICON_ASSETS.sunny,
  'cloud-sun': WEATHER_ICON_ASSETS.partlyCloudy,
  sunset: '/icons/greeting/sunset.webp',
  moon: '/icons/greeting/night.webp',
}

export function builtinIslandIcon(content: DynamicContentItem): string {
  if (content.type === 'greeting') return GREETING_ASSETS[content.icon] ?? GREETING_ASSETS.sun
  if (content.type === 'quote') return ISLAND_ASSETS.quote
  return content.icon
}

function weatherText(code: number, t: ShellTranslationKeys['weather']): string {
  if (code === 0 || code === 1) return t.sunny ?? 'Sunny'
  if (code === 2 || code === 3) return t.cloudy ?? 'Cloudy'
  if (code === 45 || code === 48) return t.foggy ?? 'Foggy'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return t.rainy ?? 'Rainy'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return t.snowy ?? 'Snowy'
  if (code >= 95 && code <= 99) return t.thunderstorm ?? 'Thunderstorm'
  return t.unavailable ?? 'Unknown'
}

/** Both the provider and the visible island derive from this single representation. */
export function buildBuiltinIslandContents({ username, locale, t, weather, quote }: {
  username?: string
  locale: string
  t: Pick<ShellTranslationKeys, 'greeting' | 'weather'>
  weather: WeatherData | null
  quote: QuoteData | null
}): DynamicContentItem[] {
  const greeting = getGreeting(username, t.greeting, locale)
  const contents: DynamicContentItem[] = [{
    type: 'greeting', icon: greeting.icon, text: greeting.text || t.greeting.afternoon,
    subtext: greeting.time, priority: 100,
  }]
  if (weather) { contents.push({
    type: 'weather', icon: weather.icon,
    text: `${weather.temperature} ${weatherText(weather.weatherCode, t.weather)}`,
    subtext: weather.city || '', showSubtext: true, priority: 90,
  })
}
  if (quote?.text) { contents.push({
    type: 'quote', icon: 'quote', text: quote.text,
    subtext: quote.author || undefined, showSubtext: false, priority: 50,
  })
}
  return contents
}
