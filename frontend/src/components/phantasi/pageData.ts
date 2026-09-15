/** skin 不进口。换源不重打轨缓存；源变更时跟 sources 一起失效。 */

import type { PhantasiItemPreview, PhantasiNoteDoc } from '../../types/phantasi'
import type { FeedStory } from './logic/feedStories'
import type { HomeBoardNote } from './logic/homeBoard'
import * as phantasiApi from '../../services/phantasiApi'
import { requestCache } from '../../utils/requestCache'
import {
  FEEDS_ARTICLE_MAX,
  latestStoryPreview,
  toFeedStory,
} from './logic/feedStories'
import { toHomeBoardNote } from './logic/homeBoard'

export const FEED_STORIES_CACHE_PREFIX = 'phantasi:feed-stories:'
export const BOARD_NOTES_CACHE_PREFIX = 'phantasi:board-notes:'
export const NOTE_DOCS_CACHE_KEY = 'phantasi:note-docs'
const BOARD_PAGE_TTL = 60_000
const BOARD_NOTES_PAGE = 100

interface CachedFeedStories {
  stamp: number
  items: FeedStory[]
}

export function feedStoriesCacheKey(sourceId: number): string {
  return `${FEED_STORIES_CACHE_PREFIX}${sourceId}`
}

export function peekFeedStories(
  sourceId: number,
  stamp?: number | null,
): FeedStory[] | null {
  const hit = requestCache.get<CachedFeedStories>(feedStoriesCacheKey(sourceId))
  if (!hit) return null
  if (stamp != null && (stamp ?? 0) !== hit.stamp) return null
  return hit.items
}

export function peekLatestStory(source: {
  id: number
  recent_items?: readonly PhantasiItemPreview[] | null
}): PhantasiItemPreview | undefined {
  return latestStoryPreview(peekFeedStoriesLoose(source.id), source.recent_items)
}

export async function loadLatestStory(
  source: {
    id: number
    last_success_at?: number | null
    recent_items?: readonly PhantasiItemPreview[] | null
  },
  signal?: AbortSignal,
): Promise<PhantasiItemPreview | undefined> {
  const latest = peekLatestStory(source)
  if (latest) return latest
  const stories = await loadFeedStories(
    source.id,
    source.last_success_at ?? 0,
    signal,
  )
  return stories[0]
}

/** 不管抓取戳；换源先画上一轮，避免闪回预览。 */
export function peekFeedStoriesLoose(sourceId: number): FeedStory[] | null {
  return (
    requestCache.get<CachedFeedStories>(feedStoriesCacheKey(sourceId))?.items ??
    null
  )
}

export function putFeedStories(
  sourceId: number,
  stamp: number | null | undefined,
  items: FeedStory[],
): void {
  requestCache.set(
    feedStoriesCacheKey(sourceId),
    { stamp: stamp ?? 0, items },
    BOARD_PAGE_TTL,
  )
}

export async function loadNoteDocs(
  signal?: AbortSignal,
): Promise<PhantasiNoteDoc[]> {
  const docs = await requestCache.fetch(
    NOTE_DOCS_CACHE_KEY,
    () => phantasiApi.listNoteDocs(),
    BOARD_PAGE_TTL,
  )
  signal?.throwIfAborted()
  return docs
}

/** 笔记墙：该笔记源上全部已发布条目。 */
export async function loadBoardNotes(
  sources: Array<{ id: number; source_type: string }>,
  signal?: AbortSignal,
): Promise<HomeBoardNote[]> {
  const ids = sources
    .filter((source) => source.source_type === 'note')
    .map((source) => source.id)
    .toSorted((left, right) => left - right)
  if (ids.length === 0) return []
  const cacheKey = `${BOARD_NOTES_CACHE_PREFIX}${ids.join(',')}`
  const load = async () => {
    const pages = await Promise.all(
      ids.map((sourceId) =>
        phantasiApi.getItemPreviews({
          source_id: sourceId,
          sort_order: 'desc',
          per_page: BOARD_NOTES_PAGE,
        }),
      ),
    )
    return pages
      .flatMap((page) => page.items.map(toHomeBoardNote))
      .toSorted((left, right) => (right.published_at ?? 0) - (left.published_at ?? 0))
  }
  const notes = await requestCache.fetch(cacheKey, load, BOARD_PAGE_TTL)
  signal?.throwIfAborted()
  return notes
}

export async function loadFeedStories(
  sourceId: number,
  stamp?: number | null,
  signal?: AbortSignal,
): Promise<FeedStory[]> {
  const normalized = stamp ?? 0
  const latest = requestCache.get<CachedFeedStories>(
    feedStoriesCacheKey(sourceId),
  )
  if (latest?.stamp === normalized) return latest.items

  // 同上：不把 signal 传进请求，换源太快时别把同一个源的请求发好几遍。
  const load = async () => {
    const res = await phantasiApi.getItemPreviews({
      source_id: sourceId,
      sort_order: 'desc',
      per_page: FEEDS_ARTICLE_MAX,
    })
    const items = res.items.map(toFeedStory)
    putFeedStories(sourceId, normalized, items)
    return items
  }
  const items = await requestCache.fetch(
    `${feedStoriesCacheKey(sourceId)}:${normalized}`,
    load,
    BOARD_PAGE_TTL,
  )
  signal?.throwIfAborted()
  return items
}
