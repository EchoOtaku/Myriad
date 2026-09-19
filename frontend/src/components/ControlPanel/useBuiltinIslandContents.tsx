import type { Locale, ShellTranslationKeys } from '../../i18n'
import type { QuoteData, WeatherData } from '../../utils/dynamicContent'
import { useEffect, useMemo } from 'react'
import { useVisibleState } from '../../hooks/useVisibleState'
import { dynamicContentProvider } from '../../services/DynamicContentProvider'
import { WeatherAssetIcon } from '../weather/WeatherAssetIcon'
import { buildBuiltinIslandContents, builtinIslandIcon } from './builtinIslandContents'
import { builtinIslandResources, loadIslandResource } from './builtinIslandResources'

export function useBuiltinIslandContents(username: string | undefined, locale: Locale, t: ShellTranslationKeys) {
  const [weather, setWeather] = useVisibleState<WeatherData | null>(null)
  const [quoteResult, setQuoteResult] = useVisibleState<{ locale: Locale, data: QuoteData | null } | null>(null)

  useEffect(() => loadIslandResource('weather', builtinIslandResources.weather, setWeather), [setWeather])
  useEffect(() => loadIslandResource(
    `quote-${locale}`,
    () => builtinIslandResources.quote(locale),
    data => setQuoteResult({ locale, data }),
  ), [locale, setQuoteResult])

  const quote = quoteResult?.locale === locale ? quoteResult.data : null
  const contents = useMemo(() => buildBuiltinIslandContents({ username, locale, t, weather, quote }),
    [username, locale, t.greeting, t.weather, weather, quote])

  useEffect(() => {
    for (const type of ['weather', 'quote'] as const) {
      if (!contents.some(content => content.type === type)) dynamicContentProvider.removeContent('builtin', type)
    }
    for (const content of contents) dynamicContentProvider.setContent('builtin', content)
  }, [contents])

  return useMemo(() => contents.map(content => ({
    ...content,
    icon: <WeatherAssetIcon icon={builtinIslandIcon(content)} className="h-6 w-6 object-contain" fallbackClassName="dynamic-icon-emoji" />,
  })), [contents])
}
