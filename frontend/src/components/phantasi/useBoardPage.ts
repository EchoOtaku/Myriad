/** skin 不进口。 */
import type { PhantasiItemPreview, PhantasiSource } from '../../types/phantasi'
import type { PhantasiBoard, SourceSortMode } from './logic/board'
import type { FeedStory, FeedStorySlot } from './logic/feedStories'
import type { HomeBoardNote } from './logic/homeBoard'
import type { PhantasiViewerRole } from './logic/score'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '../../contexts/I18nContext'

import {
  collectSourceCategories,
  filterSourcesByQuery,
  sortSourcesForBoard,
  sourcesForBoard,
} from './logic/board'
import {
  coverFeedIndices,
  expandFeedCover,
  isLatestFeedId,
  latestFeedStories,
  reuseFeedStories,
  stitchStoriesBySources,
} from './logic/feedStories'
import { noteSourceKey } from './logic/homeBoard'
import {
  loadFeedStories,
  loadHomeBoardNotes,
  peekFeedStories,
  peekFeedStoriesLoose,
} from './pageData'
import { useArticleFlags } from './useArticleFlags'

export function useBoardCatalog(
  sources: PhantasiSource[],
  board: PhantasiBoard,
  searchQuery: string,
  sortMode: SourceSortMode,
  role: PhantasiViewerRole,
  now: number,
) {
  const { locale } = useI18n()
  const categories = useMemo(() => collectSourceCategories(sources), [sources])
  const filtered = useMemo(
    () => filterSourcesByQuery(sourcesForBoard(sources, board), searchQuery),
    [sources, board, searchQuery],
  )
  const sorted = useMemo(
    () => sortSourcesForBoard(filtered, sortMode, role, now, locale),
    [filtered, sortMode, role, now, locale],
  )
  return { categories, filtered, sorted }
}

export function useBoardNotes(
  board: PhantasiBoard,
  sources: Array<{ id: number; source_type: string }>,
): HomeBoardNote[] {
  const key = useMemo(() => noteSourceKey(sources), [sources])
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const [notes, setNotes] = useState<HomeBoardNote[]>([])

  useEffect(() => {
    if (board !== 'notes') return
    if (!key) {
      setNotes([])
      return
    }
    const controller = new AbortController()
    void loadHomeBoardNotes(sourcesRef.current, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setNotes(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotes([])
      })
    return () => {
      controller.abort()
    }
    // sources 换了就重拉：发布后 item_count 可能不变，但缓存已失效。
  }, [board, key, sources])

  return notes
}

export function useFeedStories(
  board: PhantasiBoard,
  sources: readonly PhantasiSource[],
  onToggleStar?: (item: PhantasiItemPreview) => void | false | Promise<void | false>,
): {
  stories: FeedStory[]
  onStar: (item: PhantasiItemPreview) => void
  expand: (direction: 1 | -1) => void
  jump: (sourceId: number) => void
  holdStories: () => void
  releaseStories: () => void
  railEpoch: string
} {
  const flags = useArticleFlags()
  const flagsRevision = flags.getSnapshot()
  const idKey = useMemo(
    () => sources.map((source) => source.id).join(','),
    [sources],
  )
  const stampKey = useMemo(
    () =>
      sources
        .map((source) => `${source.id}:${source.last_success_at ?? 0}`)
        .join(','),
    [sources],
  )
  const lastIndex = Math.max(0, sources.length - 1)
  const [cover, setCover] = useState<number[]>(() =>
    coverFeedIndices([], 0, lastIndex, 3),
  )
  const [tick, setTick] = useState(0)
  const slotsRef = useRef<Map<number, FeedStorySlot>>(new Map())
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const inflightRef = useRef(new Set<string>())
  const fetchLiveRef = useRef(true)
  const quietRef = useRef(false)
  const pendingBumpRef = useRef(false)
  const queuedRef = useRef(false)

  const bump = useCallback(() => {
    if (!fetchLiveRef.current) return
    if (quietRef.current) {
      pendingBumpRef.current = true
      return
    }
    if (queuedRef.current) return
    queuedRef.current = true
    queueMicrotask(() => {
      queuedRef.current = false
      if (!fetchLiveRef.current) return
      if (quietRef.current) {
        pendingBumpRef.current = true
        return
      }
      setTick((value) => value + 1)
    })
  }, [])

  const holdStories = useCallback(() => {
    quietRef.current = true
  }, [])

  const releaseStories = useCallback(() => {
    if (!quietRef.current && !pendingBumpRef.current) return
    quietRef.current = false
    if (!pendingBumpRef.current) return
    pendingBumpRef.current = false
    bump()
  }, [bump])

  useEffect(() => {
    setCover(coverFeedIndices([], 0, lastIndex, 3))
  }, [board, lastIndex, idKey])

  const expand = useCallback((direction: 1 | -1) => {
    setCover((current) =>
      expandFeedCover(current, direction, sourcesRef.current.length - 1),
    )
  }, [])

  const jump = useCallback((sourceId: number) => {
    const list = sourcesRef.current
    if (isLatestFeedId(sourceId)) {
      setCover((current) => coverFeedIndices(current, 0, list.length - 1, 3))
      return
    }
    const index = list.findIndex((source) => source.id === sourceId)
    if (index < 0) return
    setCover((current) =>
      coverFeedIndices(current, index, list.length - 1, 3),
    )
  }, [])

  useEffect(() => {
    fetchLiveRef.current = true
    return () => {
      fetchLiveRef.current = false
    }
  }, [board, stampKey])

  useEffect(() => {
    if (board !== 'feeds' || sources.length === 0) return
    for (const i of cover) {
      const source = sources[i]
      if (!source) continue
      const stamp = source.last_success_at ?? 0
      const key = `${source.id}:${stamp}`
      const exact = peekFeedStories(source.id, stamp)
      const slot = slotsRef.current.get(source.id)
      if (exact && slot?.stamp !== stamp) {
        slotsRef.current.set(source.id, { stamp, items: exact })
        bump()
      }
      if (exact || slot?.stamp === stamp) continue
      if (inflightRef.current.has(key)) continue
      inflightRef.current.add(key)
      void loadFeedStories(source.id, stamp)
        .then((items) => {
          inflightRef.current.delete(key)
          const current = sourcesRef.current.find((entry) => entry.id === source.id)
          if (!fetchLiveRef.current) return
          if ((current?.last_success_at ?? 0) !== stamp) return
          slotsRef.current.set(source.id, { stamp, items })
          bump()
        })
        .catch(() => {
          inflightRef.current.delete(key)
        })
    }
  }, [board, stampKey, cover, bump])

  const fetched = useMemo(() => {
    const map = new Map<number, FeedStory[]>()
    for (const source of sources) {
      const stamp = source.last_success_at ?? 0
      const exact = peekFeedStories(source.id, stamp)
      const slot = slotsRef.current.get(source.id)
      const items = exact ?? (slot?.stamp === stamp ? slot.items : null) ?? peekFeedStoriesLoose(source.id)
      if (items) map.set(source.id, items)
    }
    return map
    // tick：某源拉完后重拼。cover 只决定去拉谁，不进这张表。
  }, [sources, tick])

  const prevStoriesRef = useRef<FeedStory[]>([])
  const stories = useMemo(() => {
    const next =
      board === 'feeds'
        ? [
            ...latestFeedStories(sources, fetched),
            ...stitchStoriesBySources(sources, fetched, 0, lastIndex),
          ].map((story) => flags.project(story))
        : []
    const reused = reuseFeedStories(prevStoriesRef.current, next)
    prevStoriesRef.current = reused
    return reused
  }, [board, fetched, flags, flagsRevision, lastIndex, sources])

  const onStar = useCallback(
    (item: PhantasiItemPreview) => onToggleStar?.(flags.project(item)),
    [onToggleStar, flags],
  )

  return {
    stories,
    onStar,
    expand,
    jump,
    holdStories,
    releaseStories,
    railEpoch: idKey,
  }
}
