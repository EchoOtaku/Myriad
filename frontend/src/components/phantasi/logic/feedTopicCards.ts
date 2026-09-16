import { normalizeTopicName } from './topics'

/** 订阅墙主题聚合卡名单。不调 phantasiApi。 */

export const TOPIC_CARD_PREVIEW = 3

export function parseFeedTopicCards(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === 'object' &&
        Array.isArray((raw as { cards?: unknown }).cards)
      ? (raw as { cards: unknown[] }).cards
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 只留现有主题，顺序跟 names。 */
export function pickEnabledTopicCards(
  names: readonly string[],
  enabled: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    if (!enabled.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 卡片上预览几篇，按时间去重。 */
export function pickTopicCardPreviews<
  T extends {
    id: number
    topic?: string | null
    published_at?: number | null
  },
>(topic: string, items: readonly T[], limit = TOPIC_CARD_PREVIEW): T[] {
  const key = normalizeTopicName(topic)
  if (!key) return []
  const seen = new Set<number>()
  return items
    .filter((item) => normalizeTopicName(item.topic) === key)
    .toSorted((a, b) => {
      const byTime = (b.published_at ?? 0) - (a.published_at ?? 0)
      return byTime !== 0 ? byTime : b.id - a.id
    })
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, limit)
}
