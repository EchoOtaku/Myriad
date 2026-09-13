/** 不调 brewApi。 */

import type { BrewItem, BrewItemPreview } from '../../../types/brew'

export const FEEDS_ARTICLE_MAX = 20
export const FRIENDS_STORY_MAX = 12

export type FeedStory = BrewItemPreview & {
  author?: string | null
  source_name?: string | null
  source_icon?: string | null
  source_id?: number
}

export function toFeedStory(
  item: Pick<
    BrewItem,
    | 'id'
    | 'title'
    | 'summary'
    | 'image'
    | 'published_at'
    | 'is_read'
    | 'is_starred'
    | 'topic'
    | 'author'
    | 'source_name'
    | 'source_icon'
  >,
): FeedStory {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    image: item.image,
    published_at: item.published_at,
    is_read: item.is_read,
    is_starred: item.is_starred,
    topic: item.topic,
    author: item.author,
    source_name: item.source_name,
    source_icon: item.source_icon,
  }
}

function storyRank(id: number, seed: number): number {
  const value = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export function storiesFromSources(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    recent_items?: readonly BrewItemPreview[] | null
  }>,
  seed: number,
  limit = FRIENDS_STORY_MAX,
): Array<FeedStory & { source_id: number }> {
  const seen = new Set<number>()
  const stories: Array<FeedStory & { source_id: number }> = []
  for (const source of sources) {
    for (const item of source.recent_items ?? []) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      stories.push({
        ...item,
        source_id: source.id,
        source_name: source.name,
        source_icon: source.icon,
      })
    }
  }
  return stories
    .toSorted((a, b) => storyRank(a.id, seed) - storyRank(b.id, seed))
    .slice(0, limit)
}

export function latestStoryPreview(
  loose: readonly BrewItemPreview[] | null | undefined,
  recent: readonly BrewItemPreview[] | null | undefined,
): BrewItemPreview | undefined {
  return loose?.[0] ?? recent?.[0]
}

export function storiesForSource(
  fetched: { id: number; items: FeedStory[] } | null,
  source: {
    id: number
    name: string
    icon: string | null
    recent_items?: readonly BrewItemPreview[] | null
  } | null,
): FeedStory[] {
  if (!source) return []
  const base =
    fetched?.id === source.id && fetched.items.length > 0
      ? fetched.items
      : (source.recent_items ?? [])
  return base.map((item) => ({
    ...item,
    source_name: source.name,
    source_icon: source.icon,
  }))
}

export interface FeedStorySlot {
  stamp: number
  items: FeedStory[]
}

/** 换源先画能用的：精确戳 → 本会话槽 → 宽松缓存 → 旧槽。 */
export function paintReadyStories(
  stamp: number,
  exact: FeedStory[] | null,
  loose: FeedStory[] | null,
  slot?: FeedStorySlot,
): FeedStory[] | null {
  return (
    exact ??
    (slot?.stamp === stamp ? slot.items : null) ??
    loose ??
    slot?.items ??
    null
  )
}

export function storiesAreFresh(
  stamp: number,
  exact: FeedStory[] | null,
  slot?: FeedStorySlot,
): boolean {
  return exact != null || slot?.stamp === stamp
}
