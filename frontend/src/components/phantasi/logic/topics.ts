/** clusterTopics 只看 item.topic。空主题不进磁贴，不建「其他」桶。 */

export interface TopicItem {
  id: number
  title: string
  image: string | null
  published_at: number | null
  /** null / 缺失不参与聚类 */
  topic?: string | null
  source_id: number
  source_name?: string | null
}

/** 旧 10 key 的 i18n 字段。新主题直接显示名字。 */
export type TopicNameKey =
  | 'topicEngineering'
  | 'topicSystems'
  | 'topicAi'
  | 'topicProduct'
  | 'topicWriting'
  | 'topicTools'
  | 'topicCulture'
  | 'topicSecurity'
  | 'topicOss'
  | 'topicHardware'

export interface PhantasiTopic {
  /** 主题名本身，也是 `?topic=` 的值。 */
  key: string
  /** 只有历史 10 key 才有；自建名是 null。 */
  nameKey: TopicNameKey | null
  hue: string
  items: TopicItem[]
}

export const TOPIC_MIN_ITEMS = 3
export const TOPIC_WINDOW_DAYS = 30
export const MAX_TOPIC_NAME_CHARS = 40

const MS_PER_DAY = 86_400_000
const TOPIC_HUES = [210, 160, 25, 280, 340, 190, 45, 310] as const

interface LeftoverTopicDef {
  key: string
  nameKey: TopicNameKey
  hue: string
}

/** 库里还在的旧英文 key，只用来翻译和上色，不再当写入白名单。 */
const LEFTOVER_TOPIC_DEFS: readonly LeftoverTopicDef[] = [
  { key: 'engineering', nameKey: 'topicEngineering', hue: '#6366f1' },
  { key: 'systems', nameKey: 'topicSystems', hue: '#0ea5e9' },
  { key: 'ai', nameKey: 'topicAi', hue: '#8b5cf6' },
  { key: 'product', nameKey: 'topicProduct', hue: '#f97316' },
  { key: 'writing', nameKey: 'topicWriting', hue: '#d97706' },
  { key: 'tools', nameKey: 'topicTools', hue: '#14b8a6' },
  { key: 'culture', nameKey: 'topicCulture', hue: '#ec4899' },
  { key: 'security', nameKey: 'topicSecurity', hue: '#ef4444' },
  { key: 'oss', nameKey: 'topicOss', hue: '#22c55e' },
  { key: 'hardware', nameKey: 'topicHardware', hue: '#64748b' },
]

export const PREDEFINED_TOPICS: readonly string[] = LEFTOVER_TOPIC_DEFS.map((d) => d.key)

const LEFTOVER_BY_KEY = new Map(LEFTOVER_TOPIC_DEFS.map((d) => [d.key, d]))

export function isPredefinedTopic(key: string | null | undefined): boolean {
  return Boolean(key && LEFTOVER_BY_KEY.has(key))
}

export function topicNameKey(key: string): TopicNameKey | null {
  return LEFTOVER_BY_KEY.get(key)?.nameKey ?? null
}

export function normalizeTopicName(
  value: string | null | undefined,
): string | null {
  const name = value?.trim() ?? ''
  if (!name) return null
  return [...name].slice(0, MAX_TOPIC_NAME_CHARS).join('')
}

export function topicDisplayName(
  topic: { key: string; nameKey?: TopicNameKey | null },
  labels: Partial<Record<TopicNameKey, string>>,
): string {
  const nameKey = topic.nameKey ?? topicNameKey(topic.key)
  if (nameKey) {
    const value = labels[nameKey]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return topic.key
}

function hashTopicHue(name: string): string {
  let hash = 0
  for (const ch of name) {
    hash = (Math.imul(hash, 31) + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  const hue = TOPIC_HUES[hash % TOPIC_HUES.length] ?? 210
  return `hsl(${hue} 42% 46%)`
}

export function topicHue(key: string): string {
  return LEFTOVER_BY_KEY.get(key)?.hue ?? hashTopicHue(key)
}

/** 只收窗口内且 topic 非空的文章。无 published_at 则跳过。不足 TOPIC_MIN_ITEMS 不成卡。 */
export function clusterTopics(
  items: readonly TopicItem[],
  now: number,
): PhantasiTopic[] {
  const cutoff = now - TOPIC_WINDOW_DAYS * MS_PER_DAY
  const eligible = items.filter((item) => {
    const key = normalizeTopicName(item.topic)
    if (!key) return false
    const at = item.published_at
    return typeof at === 'number' && at > 0 && at >= cutoff
  })
  const buckets = Map.groupBy(eligible, (item) => normalizeTopicName(item.topic) as string)

  return Iterator.from(buckets.entries()).toArray()
    .filter(([, list]) => list.length >= TOPIC_MIN_ITEMS)
    .map(([key, list]) => ({
      key,
      nameKey: topicNameKey(key),
      hue: topicHue(key),
      items: list.toSorted(
        (a, b) => (b.published_at ?? 0) - (a.published_at ?? 0),
      ),
    }))
    .toSorted((a, b) => {
      if (b.items.length !== a.items.length) return b.items.length - a.items.length
      return a.key.localeCompare(b.key)
    })
}

/** 不为主题卡新开接口。笔记源不进订阅主题聚类。 */
export function previewsToTopicItems(
  sources: readonly {
    id: number
    name: string
    source_type?: string
    recent_items?: {
      id: number
      title: string
      image: string | null
      published_at: number | null
      topic?: string | null
    }[]
  }[],
): TopicItem[] {
  const out: TopicItem[] = []
  for (const s of sources) {
    if (s.source_type === 'note') continue
    for (const p of s.recent_items ?? []) {
      out.push({
        id: p.id,
        title: p.title,
        image: p.image,
        published_at: p.published_at,
        topic: p.topic ?? null,
        source_id: s.id,
        source_name: s.name,
      })
    }
  }
  return out
}

export function topicSourceCount(topic: PhantasiTopic): number {
  return new Set(topic.items.map((i) => i.source_id)).size
}
