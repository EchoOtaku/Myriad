/** skin 不进口。换源不重打轨缓存；源变更时跟 sources 一起失效。 */

import type { PhantasiItemPreview, PhantasiNoteDoc } from '../../types/phantasi'
import type { FeedStory } from './logic/feedStories'
import type { HomeBoardNote } from './logic/homeBoard'
import * as phantasiApi from '../../services/phantasiApi'
import {
  PHANTASI_BOARD_NOTES_CACHE_PREFIX,
  PHANTASI_FEED_STORIES_CACHE_PREFIX,
  phantasiCacheKeys,
} from '../../services/phantasiCache'
import { requestCache } from '../../utils/requestCache'
import { SharedRequest } from '../../utils/sharedRequest'
import {
  FEEDS_ARTICLE_MAX,
  latestStoryPreview,
  toFeedStory,
} from './logic/feedStories'
import { toHomeBoardNote } from './logic/homeBoard'

export const FEED_STORIES_CACHE_PREFIX = PHANTASI_FEED_STORIES_CACHE_PREFIX
export const BOARD_NOTES_CACHE_PREFIX = PHANTASI_BOARD_NOTES_CACHE_PREFIX
export const NOTE_DOCS_CACHE_KEY = phantasiCacheKeys.noteDocs
const BOARD_PAGE_TTL = 60_000
const BOARD_NOTES_PAGE = 100

export function feedStoriesCacheKey(sourceId: number, stamp = 0): string {
  return phantasiCacheKeys.feedStories(sourceId, stamp)
}

export function peekFeedStories(
  sourceId: number,
  stamp?: number | null,
): FeedStory[] | null {
  return requestCache.get<FeedStory[]>(
    feedStoriesCacheKey(sourceId, stamp ?? 0),
  )
}

export function peekLatestStory(source: {
  id: number
  recent_items?: readonly PhantasiItemPreview[] | null
}): PhantasiItemPreview | undefined {
  return latestStoryPreview(
    peekFeedStoriesLoose(source.id),
    source.recent_items,
  )
}

export async function loadLatestStory(
  source: {
    id: number
    last_success_at?: number | null
    recent_items?: readonly PhantasiItemPreview[] | null
  },
  signal?: AbortSignal,
): Promise<PhantasiItemPreview | undefined> {
  signal?.throwIfAborted()
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
  const prefix = phantasiCacheKeys.feedStoriesForSource(sourceId)
  const key = requestCache.keys
    .toReversed()
    .find((candidate) => candidate.startsWith(prefix))
  return key ? requestCache.get<FeedStory[]>(key) : null
}

export function putFeedStories(
  sourceId: number,
  stamp: number | null | undefined,
  items: FeedStory[],
): void {
  requestCache.set(
    feedStoriesCacheKey(sourceId, stamp ?? 0),
    items,
    BOARD_PAGE_TTL,
  )
}

export async function loadNoteDocs(
  signal?: AbortSignal,
): Promise<PhantasiNoteDoc[]> {
  const docs = await requestCache.fetch(
    NOTE_DOCS_CACHE_KEY,
    (transportSignal) => phantasiApi.listNoteDocs(transportSignal),
    BOARD_PAGE_TTL,
    false,
    signal,
  )
  signal?.throwIfAborted()
  return docs
}

type NotePage = Awaited<ReturnType<typeof phantasiApi.getItemPreviews>>
interface NotePages {
  pages: Map<string, NotePage>
  complete?: HomeBoardNote[]
  bytes: number
  pending: Map<string, SharedRequest<NotePage>>
}

function loadNotePage(sourceId: number, cursor?: string, signal?: AbortSignal): Promise<NotePage> {
  // Each source bucket is bounded by page count and UTF-16 payload bytes.
  const key = `${phantasiCacheKeys.boardNotes([sourceId])}:pages`
  let bucket = requestCache.get<NotePages>(key)
  if (!bucket) {
    bucket = { pages: new Map(), pending: new Map(), bytes: 0 }
    requestCache.set(key, bucket, BOARD_PAGE_TTL)
  }
  const pages = bucket
  const pageKey = cursor ?? ''
  const hit = pages.pages.get(pageKey)
  if (hit) return Promise.resolve(hit)
  const pending = pages.pending.get(pageKey)
  if (pending && !pending.controller.signal.aborted) return pending.wait(signal)
  const request = new SharedRequest<NotePage>(transportSignal => phantasiApi
    .getItemPreviews({
      source_id: sourceId,
      sort_order: 'desc',
      per_page: BOARD_NOTES_PAGE,
      cursor,
    }, undefined, { signal: transportSignal })
    .then((page) => {
      transportSignal.throwIfAborted()
      const bytes = JSON.stringify(page).length * 2
      if (bytes <= 2 * 1024 * 1024) {
        pages.pages.set(pageKey, page)
        pages.bytes += bytes
        while (pages.pages.size > 128 || pages.bytes > 2 * 1024 * 1024) {
          const oldest = pages.pages.keys().next().value!
          pages.bytes -= JSON.stringify(pages.pages.get(oldest)).length * 2
          pages.pages.delete(oldest)
          pages.complete = undefined
        }
      }
      if (!page.next_cursor?.trim()) {
        const all = new Map<number, HomeBoardNote>()
        const seen = new Set<string>()
        let cursorKey = ''
        while (!seen.has(cursorKey)) {
          seen.add(cursorKey)
          const cached = pages.pages.get(cursorKey)
          if (!cached) break
          for (const item of cached.items)
            all.set(item.id, toHomeBoardNote(item))
          const next = cached.next_cursor?.trim()
          if (!next) {
            pages.complete = [...all.values()]
            break
          }
          cursorKey = next
        }
      }
      // An invalidation or a newer bucket owns the key now: never resurrect it.
      if (requestCache.get(key) === pages)
        requestCache.set(key, pages, BOARD_PAGE_TTL)
      return page
    }))
  const clearPending = () => {
    if (pages.pending.get(pageKey) === request) pages.pending.delete(pageKey)
  }
  void request.promise.then(clearPending, clearPending)
  pages.pending.set(pageKey, request)
  return request.wait(signal)
}

/**
 * Share individual pages, not the consumer's traversal: leaving stops later pages
 * without cancelling a page another mounted consumer is still awaiting.
 * The last consumer leaving also cancels the current page's transport.
 */
export async function loadBoardNotes(
  sources: Array<{ id: number; source_type: string }>,
  signal?: AbortSignal,
  onPage?: (notes: HomeBoardNote[]) => void,
  pageLimit = Infinity,
  onMore?: (hasMore: boolean) => void,
): Promise<HomeBoardNote[]> {
  signal?.throwIfAborted()
  const ids = [
    ...new Set(
      sources
        .filter((source) => source.source_type === 'note')
        .map((source) => source.id),
    ),
  ]
  const completed = ids.map(
    (id) =>
      requestCache.get<NotePages>(`${phantasiCacheKeys.boardNotes([id])}:pages`)
        ?.complete,
  )
  if (pageLimit === Infinity && completed.every((notes) => notes != null)) {
    const notes = completed
      .flatMap((notes) => notes ?? [])
      .toSorted(
        (left, right) =>
          (right.published_at ?? 0) - (left.published_at ?? 0) ||
          right.id - left.id,
      )
    onPage?.(notes)
    return notes
  }
  const queue = ids.map((id) => ({
    id,
    cursor: undefined as string | undefined,
    seen: new Set<string>(),
    loaded: 0,
  }))
  const items = new Map<number, HomeBoardNote>()
  let snapshot: HomeBoardNote[] = []
  const sortedSnapshot = () => [...items.values()].toSorted(
    (left, right) =>
      (right.published_at ?? 0) - (left.published_at ?? 0) ||
      right.id - left.id,
  )
  let failed = false
  let hasMore = false
  const load = async () => {
    try {
      while (queue.length > 0) {
        if (failed) return
        signal?.throwIfAborted()
        const source = queue.shift()!
        const page = await loadNotePage(source.id, source.cursor, signal)
        signal?.throwIfAborted()
        if (failed) return
        for (const item of page.items) items.set(item.id, toHomeBoardNote(item))
        if (pageLimit === Infinity) {
          snapshot = sortedSnapshot()
          onPage?.(snapshot)
        }
        const next = page.next_cursor?.trim()
        if (next) {
          if (source.seen.has(next)) {
            throw new Error(
              'Journal notes pagination returned a repeated cursor',
            )
          }
          source.seen.add(next)
          if (source.loaded + 1 < pageLimit)
            queue.push({ ...source, cursor: next, loaded: source.loaded + 1 })
          else hasMore = true
        }
        // Cached pages must not form one long microtask chain starving input/paint.
        if (onPage && queue.length > 0)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } catch (error) {
      failed = true
      throw error
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, load))
  signal?.throwIfAborted()
  // A demand-driven batch may revisit cached pages. Publish it atomically,
  // without repeatedly sorting or replacing the wall with partial history.
  if (pageLimit !== Infinity) {
    snapshot = sortedSnapshot()
    onPage?.(snapshot)
  }
  onMore?.(hasMore)
  return snapshot
}

export async function loadTopicCatalog(
  signal?: AbortSignal,
): Promise<{ topics: string[]; cards: string[] }> {
  const catalog = await phantasiApi.listSubscriptionTopicCatalog(undefined, { signal })
  signal?.throwIfAborted()
  return catalog
}

export async function loadFeedStories(
  sourceId: number,
  stamp?: number | null,
  signal?: AbortSignal,
): Promise<FeedStory[]> {
  signal?.throwIfAborted()
  const normalized = stamp ?? 0
  const cacheKey = feedStoriesCacheKey(sourceId, normalized)
  const latest = requestCache.get<FeedStory[]>(cacheKey)
  if (latest) return latest

  // Consumers share IO; only the last cancellation aborts the transport.
  const load = async (transportSignal: AbortSignal) => {
    const res = await phantasiApi.getItemPreviews({
      source_id: sourceId,
      sort_order: 'desc',
      per_page: FEEDS_ARTICLE_MAX,
    }, undefined, { signal: transportSignal })
    return res.items.map(toFeedStory)
  }
  const items = await requestCache.fetch(cacheKey, load, BOARD_PAGE_TTL, false, signal)
  signal?.throwIfAborted()
  return items
}

export async function loadTopicStories(
  topic: string,
  signal?: AbortSignal,
): Promise<FeedStory[]> {
  const res = await phantasiApi.getItemPreviews(
    {
      topic,
      sort_order: 'desc',
      per_page: FEEDS_ARTICLE_MAX,
    },
    undefined,
    { signal },
  )
  signal?.throwIfAborted()
  return res.items.map(toFeedStory)
}
