import type { MutableRefObject } from 'react'
import type {
  PhantasiItem,
  PhantasiItemPreview,
  PhantasiSource,
} from '../../types/phantasi'
import type { PhantasiBoard, PhantasiViewMode } from './logic/board'

import type { ArticleLoader, OpenArticleOptions } from './useArticleOpen'
import { useCallback, useEffect, useRef } from 'react'
import * as phantasiApi from '../../services/phantasiApi'
import { phantasiItemState } from '../../utils/phantasiItemState'
import { isSiteSource } from './logic/board'
import { readingQueue, readingQueueFromStories } from './logic/readingQueue'
import { phantasiItemFromWebSearch, webSearchInList } from './logic/webSearchItem'
import {
  loadLatestStory,
  peekFeedStories,
} from './pageData'
import { reportPhantasiError } from './phantasiNotice'
import { trackPhantasi } from './phantasiTrack'

interface StarTarget {
  id: number
  is_starred: boolean
  source_id?: number
}

type ReadingListNav = {
  currentList?: {
    items: Array<{
      id: number
      title: string
      author?: string | null
      sourceName?: string | null
      publishedAt?: string | null
      summary?: string | null
      relevanceReason?: string | null
      link?: string | null
      content?: string | null
      fromWebSearch?: boolean
    }>
  } | null
  goToArticle: (index: number) => void
} | null

export function usePhantasiItemActions({
  isAuthenticated,
  openArticle,
  viewMode,
  board,
  selectedItem,
  setError,
  itemsRef,
  unselectStarred,
  navigate,
  readingList,
  labels,
}: {
  openArticle: (
    target: PhantasiItem | ArticleLoader,
    options?: OpenArticleOptions,
  ) => Promise<PhantasiItem | undefined>
  isAuthenticated: boolean
  viewMode: PhantasiViewMode
  board: PhantasiBoard
  selectedItem: PhantasiItem | null
  setError: (message: string) => void
  itemsRef: MutableRefObject<PhantasiItem[]>
  unselectStarred: (id: number) => void
  navigate: (to: string) => void
  readingList: ReadingListNav
  labels: {
    starFailed: string
    readingFailed: string
    loadFailed: string
    webSearch: string
  }
}) {
  const pendingReads = useRef(new Set<number>())
  const pendingStars = useRef(new Set<number>())
  const markOpened = useCallback(
    async (item: PhantasiItem) => {
      trackPhantasi('PHANTASI_OPEN_ITEM', item.source_id || item.id, 1500)
      if (
        !isAuthenticated ||
        item.fromWebSearch ||
        pendingReads.current.has(item.id)
      ) {
        return
}
      if (!item.is_read) {
        pendingReads.current.add(item.id)
        phantasiItemState.preview(item.id, { is_read: true })
        try {
          await phantasiApi.markRead(item.id)
        } catch (err) {
          phantasiItemState.discardPreview(item.id, { is_read: true })
          reportPhantasiError(err, labels.readingFailed, setError)
        } finally {
          pendingReads.current.delete(item.id)
        }
      }
    },
    [
      isAuthenticated,
      openArticle,
      setError,
      labels.readingFailed,
    ],
  )

  const markOpenedRef = useRef(markOpened)
  markOpenedRef.current = markOpened
  useEffect(() => {
    if (selectedItem) void markOpenedRef.current(selectedItem)
    // Opening is an item transition; field updates must not re-mark unread items.
  }, [selectedItem?.id, isAuthenticated])

  const select = useCallback(
    async (item: PhantasiItem) => {
      const origin =
        viewMode === 'starred'
          ? 'starred'
          : viewMode === 'topic-feed'
            ? 'topic'
            : board === 'notes'
              ? 'notes'
              : 'feeds'
      await openArticle(
        item.fromWebSearch
          ? item
          : (signal) => phantasiApi.getItem(item.id, undefined, { signal }),
        {
          queue: readingQueue(origin, itemsRef.current),
        },
      )
    },
    [openArticle, viewMode, board, itemsRef],
  )

  const openPreview = useCallback(
    async (
      preview: PhantasiItemPreview,
      source: PhantasiSource,
      neighbors?: Array<{ id: number; title: string }>,
    ) => {
      if (isSiteSource(source)) return
      await openArticle(
        (signal) => phantasiApi.getItem(preview.id, undefined, { signal }),
        {
          queue: readingQueueFromStories(
            board === 'notes' ? 'notes' : 'feeds',
            board === 'notes'
              ? neighbors
              : peekFeedStories(source.id, source.last_success_at ?? 0),
            [preview],
          ),
        },
      )
    },
    [openArticle, board],
  )

  const openLatest = useCallback(
    async (source: PhantasiSource) => {
      if (isSiteSource(source)) return
      await openArticle(
        async (signal) => {
          const first = await loadLatestStory(source, signal)
          return first
            ? phantasiApi.getItem(first.id, undefined, { signal })
            : null
        },
        {
          queue: readingQueueFromStories(
            board === 'notes' ? 'notes' : 'feeds',
            board === 'notes'
              ? undefined
              : peekFeedStories(source.id, source.last_success_at ?? 0),
            [],
          ),
        },
      )
    },
    [openArticle, board],
  )

  const navigateToArticle = useCallback(
    async (articleId: number) => {
      const webHit = webSearchInList(readingList?.currentList?.items, articleId)
      if (webHit && readingList) {
        await openArticle(phantasiItemFromWebSearch(webHit.item, labels.webSearch))
        readingList.goToArticle(webHit.index)
        return
      }

      await openArticle(
        (signal) => phantasiApi.getItem(articleId, undefined, { signal }),
      )
    },
    [
      readingList,
      openArticle,
      itemsRef,
      setError,
      markOpened,
      labels.webSearch,
      labels.loadFailed,
    ],
  )

  const toggleStar = useCallback(
    (item: StarTarget): false | Promise<void | false> => {
      if (!isAuthenticated) {
        navigate('/login')
        return false
      }
      if (pendingStars.current.has(item.id)) return false
      pendingStars.current.add(item.id)
      const nextStarred = !item.is_starred
      phantasiItemState.preview(item.id, { is_starred: nextStarred })
      return (async () => {
        try {
          if (item.is_starred) {
            await phantasiApi.unstarItem(item.id)
            trackPhantasi('PHANTASI_UNSTAR', item.source_id || item.id, 1000)
          } else {
            await phantasiApi.starItem(item.id)
            trackPhantasi('PHANTASI_STAR', item.source_id || item.id, 1000)
          }
          const next = !item.is_starred
          if (viewMode === 'starred' && !next) {
            unselectStarred(item.id)
          }
        } catch (err) {
          phantasiItemState.discardPreview(item.id, { is_starred: nextStarred })
          reportPhantasiError(err, labels.starFailed, setError)
          return false
        } finally {
          pendingStars.current.delete(item.id)
        }
      })()
    },
    [
      isAuthenticated,
      navigate,
      viewMode,
      selectedItem?.id,
      unselectStarred,
      setError,
      labels.starFailed,
    ],
  )

  const toggleRead = useCallback(
    async (item: PhantasiItem) => {
      if (
        !isAuthenticated ||
        item.fromWebSearch ||
        pendingReads.current.has(item.id)
      ) {
        return
}
      pendingReads.current.add(item.id)
      const nextRead = !item.is_read
      phantasiItemState.preview(item.id, { is_read: nextRead })
      try {
        if (item.is_read) await phantasiApi.markUnread(item.id)
        else await phantasiApi.markRead(item.id)
      } catch (err) {
        phantasiItemState.discardPreview(item.id, { is_read: nextRead })
        reportPhantasiError(err, labels.readingFailed, setError)
      } finally {
        pendingReads.current.delete(item.id)
      }
    },
    [
      isAuthenticated,
      selectedItem?.id,
      setError,
      labels.readingFailed,
    ],
  )

  const markAllRead = useCallback(async () => {
    try {
      await phantasiApi.markAllRead({})
    } catch (err) {
      reportPhantasiError(err, labels.readingFailed, setError)
    }
  }, [setError, labels.readingFailed])

  return {
    select,
    openPreview,
    openLatest,
    navigateToArticle,
    toggleStar,
    toggleRead,
    markAllRead,
  }
}
