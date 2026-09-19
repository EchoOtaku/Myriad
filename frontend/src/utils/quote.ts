import { API_URL } from '../config'
import { currentCopy } from '../i18n/localeCopy'
import apiService from '../services/api'
import { awaitAbortable } from './awaitAbortable'
import { formatUserFacingError } from './formatUserFacingError'
import { httpStatusMessage } from './httpStatus'
import { RequestCache } from './requestCache'

export interface QuoteData {
  text: string
  author?: string
}

export interface HitokotoSource {
  id: string
  url: string
  textField: string
  authorField?: string
}

export const BUILTIN_HITOKOTO_SOURCES: Record<string, HitokotoSource> = {
  'hitokoto-cn': {
    id: 'hitokoto-cn',
    url: 'https://v1.hitokoto.cn/?c=d&c=i&c=k&encode=json',
    textField: 'hitokoto',
    authorField: 'from',
  },
  'hitokoto-anime': {
    id: 'hitokoto-anime',
    url: 'https://v1.hitokoto.cn/?c=a&c=b&encode=json',
    textField: 'hitokoto',
    authorField: 'from',
  },
  'quotable-en': {
    id: 'quotable-en',
    url: 'https://api.quotable.io/random',
    textField: 'content',
    authorField: 'author',
  },
  'meigen-ja': {
    id: 'meigen-ja',
    url: 'https://meigen.doodlenote.net/api/json.php',
    textField: 'meigen',
    authorField: 'auther',
  },
}

export const DEFAULT_HITOKOTO_SOURCE_ID = 'hitokoto-cn'

export interface HitokotoConfig {
  sourceId: string
  customUrl?: string
  customTextField?: string
  customAuthorField?: string
}

interface HitokotoConfigResponse {
  success: boolean
  config?: HitokotoConfig
  message?: string
}

export const DEFAULT_HITOKOTO_CONFIG: HitokotoConfig = {
  sourceId: DEFAULT_HITOKOTO_SOURCE_ID,
}

export const HITOKOTO_CONFIG_UPDATED_EVENT = 'hitokoto-config-updated'

export function normalizeHitokotoConfig(
  config?: Partial<HitokotoConfig>,
): HitokotoConfig {
  return {
    sourceId:
      typeof config?.sourceId === 'string'
        ? config.sourceId
        : DEFAULT_HITOKOTO_SOURCE_ID,
    customUrl: config?.customUrl,
    customTextField: config?.customTextField,
    customAuthorField: config?.customAuthorField,
  }
}

/* Do not persist hitokoto config in localStorage. */
const HITOKOTO_CONFIG_TTL = 5 * 60 * 1000
const hitokotoConfigCache = new RequestCache(1)
const HITOKOTO_CONFIG_KEY = '/config/hitokoto'

export function clearHitokotoConfigCache(): void {
  hitokotoConfigCache.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener(HITOKOTO_CONFIG_UPDATED_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<HitokotoConfig | undefined>).detail
    if (detail && typeof detail.sourceId === 'string') {
      hitokotoConfigCache.set(HITOKOTO_CONFIG_KEY, normalizeHitokotoConfig(detail), HITOKOTO_CONFIG_TTL)
      return
    }
    clearHitokotoConfigCache()
  })
}

export async function fetchHitokotoConfig(
  options?: { force?: boolean },
): Promise<HitokotoConfig> {
  // Force detaches the previous request; its late result must not own the cache.
  if (options?.force) hitokotoConfigCache.delete(HITOKOTO_CONFIG_KEY)
  return hitokotoConfigCache.fetch(HITOKOTO_CONFIG_KEY, async () => {
    const response = await apiService.get<HitokotoConfigResponse>(HITOKOTO_CONFIG_KEY)
    return normalizeHitokotoConfig(response.config)
  }, HITOKOTO_CONFIG_TTL)
}

/** Cached presentation is optional and must not block confirmed config updates. */
export function clearQuoteContentCache(): void {
  for (const key of ['quote_cache', 'quote_cache_time', 'quote_cache_source', 'quote_data_cache']) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Continue invalidating the remaining keys if one storage operation fails.
    }
  }
}

export async function updateHitokotoConfig(
  config: HitokotoConfig,
): Promise<HitokotoConfig> {
  const response = await apiService.put<HitokotoConfigResponse>(
    '/config/hitokoto',
    config,
  )
  if (!response.success) {
    throw new Error(
      await formatUserFacingError(
        response.message,
        currentCopy().config.hitokotoSaveFailed,
      ),
    )
  }
  const saved = normalizeHitokotoConfig(response.config)
  hitokotoConfigCache.set(HITOKOTO_CONFIG_KEY, saved, HITOKOTO_CONFIG_TTL)
  clearQuoteContentCache()
  window.dispatchEvent(
    new CustomEvent(HITOKOTO_CONFIG_UPDATED_EVENT, { detail: saved }),
  )
  return saved
}

export function areHitokotoConfigsEqual(
  left: HitokotoConfig,
  right: HitokotoConfig,
): boolean {
  return (
    left.sourceId === right.sourceId &&
    (left.customUrl ?? '') === (right.customUrl ?? '') &&
    (left.customTextField ?? '') === (right.customTextField ?? '') &&
    (left.customAuthorField ?? '') === (right.customAuthorField ?? '')
  )
}

export async function resolveHitokotoSource(
  config?: HitokotoConfig,
): Promise<HitokotoSource | null> {
  const resolved = config ?? (await fetchHitokotoConfig())
  return resolveHitokotoSourceFromConfig(resolved)
}

function resolveHitokotoSourceFromConfig(
  config: HitokotoConfig,
): HitokotoSource | null {
  if (config.sourceId === 'custom') {
    const url = config.customUrl?.trim()
    if (!url) return null
    return {
      id: 'custom',
      url,
      textField: config.customTextField?.trim() || 'hitokoto',
      authorField: config.customAuthorField?.trim() || 'from',
    }
  }
  return (
    BUILTIN_HITOKOTO_SOURCES[config.sourceId] ??
    BUILTIN_HITOKOTO_SOURCES[DEFAULT_HITOKOTO_SOURCE_ID]
  )
}

function readQuoteCache(sourceUrl: string): QuoteData | null {
  try {
    const cached = localStorage.getItem('quote_cache')
    const time = localStorage.getItem('quote_cache_time')
    const source = localStorage.getItem('quote_cache_source')
    if (!cached || !time || source !== sourceUrl) return null
    if (!(Date.now() - Number.parseInt(time) < 10 * 60 * 1000)) return null
    const data = JSON.parse(cached)
    return typeof data?.text === 'string' && data.text.trim() ? data : null
  } catch {
    return null
  }
}

function writeQuoteCache(data: QuoteData, sourceUrl: string): void {
  try {
    localStorage.setItem('quote_cache', JSON.stringify(data))
    localStorage.setItem('quote_cache_time', Date.now().toString())
    localStorage.setItem('quote_cache_source', sourceUrl)
  } catch {
    // Keep the network result even when persistent storage is unavailable.
  }
}

export async function getRandomQuote(
  locale?: string,
  signal?: AbortSignal,
): Promise<QuoteData | null> {
  let source: HitokotoSource | null
  try {
    signal?.throwIfAborted()
    const resolving = resolveHitokotoSource()
    source = await (signal ? awaitAbortable(resolving, signal) : resolving)
    signal?.throwIfAborted()
  } catch (error) {
    signal?.throwIfAborted()
    console.warn('Failed to load hitokoto config:', error)
    return getLocalQuote(locale)
  }
  if (!source) return getLocalQuote(locale)

  try {
    const cached = readQuoteCache(source.url)
    if (cached) return cached

    // Proxy (CORS).
    const proxyUrl =
      source.id === DEFAULT_HITOKOTO_SOURCE_ID
        ? `${API_URL}/api/proxy/hitokoto`
        : `${API_URL}/api/proxy/hitokoto?url=${encodeURIComponent(source.url)}`

    const response = await fetch(proxyUrl, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    })

    if (!response.ok) throw new Error(httpStatusMessage(response.status))

    const data = await response.json()
    const payload = Array.isArray(data) ? data[0] : data

    const text = payload?.[source.textField]
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Hitokoto response missing text field')
    }
    const author = source.authorField
      ? payload?.[source.authorField]
      : undefined

    const quoteData: QuoteData = {
      text,
      author: typeof author === 'string' && author.trim() ? author : undefined,
    }

    signal?.throwIfAborted()
    writeQuoteCache(quoteData, source.url)

    return quoteData
  } catch (error) {
    signal?.throwIfAborted()
    console.warn('Failed to fetch quote:', error)
    return getLocalQuote(locale)
  }
}

function getLocalQuote(locale?: string): QuoteData {
  const quotesZhCN = [
    { text: '代码如诗，优雅至上', author: '程序员格言' },
    { text: '简洁是可靠的前提', author: 'Edsger Dijkstra' },
    { text: '过早优化是万恶之源', author: 'Donald Knuth' },
    {
      text: '任何可以被编写成 JavaScript 的程序，最终都会被编写成 JavaScript',
      author: 'Atwood 定律',
    },
    { text: '好的代码本身就是最好的文档', author: 'Steve McConnell' },
    { text: '先让它运行起来，再让它变得更好', author: 'Kent Beck' },
    { text: '代码是写给人看的，顺便让机器执行', author: 'Harold Abelson' },
    {
      text: '测试不能证明程序没有 bug，只能证明 bug 的存在',
      author: 'Edsger Dijkstra',
    },
  ]

  const quotesEnUS = [
    {
      text: "Code is like humor. When you have to explain it, it's bad.",
      author: 'Cory House',
    },
    { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
    { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
    { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
    { text: 'Software is eating the world.', author: 'Marc Andreessen' },
    {
      text: 'The best way to predict the future is to invent it.',
      author: 'Alan Kay',
    },
  ]

  const quotesJaJP = [
    { text: 'コードは詩のように、優雅であれ', author: 'プログラマーの格言' },
    { text: 'シンプルさは信頼性の前提条件である', author: 'Edsger Dijkstra' },
    { text: '早すぎる最適化は諸悪の根源', author: 'Donald Knuth' },
    {
      text: '動くようにしてから、正しくしてから、速くする',
      author: 'Kent Beck',
    },
    { text: '良いコードは最高のドキュメントである', author: 'Steve McConnell' },
    {
      text: '未来を予測する最良の方法は、それを発明することだ',
      author: 'Alan Kay',
    },
  ]

  let quotes: QuoteData[]
  switch (locale) {
    case 'en-US':
    case 'ko-KR':
    case 'fr-FR':
    case 'de-DE':
      quotes = quotesEnUS
      break
    case 'ja-JP':
      quotes = quotesJaJP
      break
    default:
      quotes = quotesZhCN
  }

  return quotes[Math.floor(Math.random() * quotes.length)]
}
