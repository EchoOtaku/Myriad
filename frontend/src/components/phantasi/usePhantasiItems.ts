/** 订阅轨不走这里。 */
import type { PhantasiItem } from '../../types/phantasi'
import type { PhantasiViewMode } from './logic/board'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import * as phantasiApi from '../../services/phantasiApi'
import { itemListHasMore, itemListRequest } from './logic/itemList'
import { appendUniqueById } from './logic/itemState'
import { RequestTurn } from './logic/requestTurn'
import { reportPhantasiError } from './phantasiNotice'
import { useArticleFlags } from './useArticleFlags'

export function usePhantasiItems(
  loadFailed: string,
  setError: (message: string) => void,
  viewMode: PhantasiViewMode,
  topicKey?: string,
) {
  const flags = useArticleFlags()
  const flagsRevision = flags.getSnapshot()
  const [page, setPage] = useState({ items: [] as PhantasiItem[], total: 0, hasMore: true })
  const { items: rawItems, total, hasMore } = page
  const items = useMemo(() => rawItems.map(item => flags.project(item)).filter(item => viewMode !== 'starred' || item.is_starred !== false), [rawItems, flagsRevision, viewMode])
  const [itemsLoading, setItemsLoading] = useState(false)
  const nextCursorRef = useRef<string | null>(null)
  const membershipDirty = useRef(false)
  const loadRequestIdRef = useRef(0)
  const loadingRef = useRef(false)
  const turns = useRef(new RequestTurn())
  const itemsRef = useRef<PhantasiItem[]>([])
  itemsRef.current = items
  const queryRef = useRef({ viewMode, topicKey })
  queryRef.current = { viewMode, topicKey }

  const invalidateMembership = useCallback(() => {
    membershipDirty.current = true
    turns.current.cancel()
    loadRequestIdRef.current++
    loadingRef.current = false
    setItemsLoading(false)
  }, [])

  const loadItems = useCallback(
    async (reset = false) => {
      if (!reset && loadingRef.current) return
      if (viewMode !== 'starred' && !(viewMode === 'topic-feed' && topicKey)) {
        return
      }

      const requestId = ++loadRequestIdRef.current
      const signal = turns.current.begin()
      loadingRef.current = true
      setItemsLoading(true)
      try {
        const rebuild = reset || membershipDirty.current
        if (rebuild) nextCursorRef.current = null
        const cursor = rebuild ? undefined : nextCursorRef.current ?? undefined
        const paging = itemListRequest({ cursor, perPage: 20 })
        const data = await phantasiApi.getItemPreviews(
          {
            topic: viewMode === 'topic-feed' ? topicKey : undefined,
            filter: viewMode === 'starred' ? 'starred' : 'all',
            ...paging,
          },
          undefined,
          { signal },
        )
        if (signal.aborted || requestId !== loadRequestIdRef.current) return
        const collected = data.items.map((item) => ({ ...item, content: null }))
        membershipDirty.current = false
        nextCursorRef.current = data.next_cursor ?? null
        const perPage = data.per_page > 0 ? data.per_page : 20
        setPage(prev => ({
          items: rebuild ? collected : appendUniqueById(prev.items, collected),
          total: cursor ? prev.total : data.total,
          hasMore: itemListHasMore(data.next_cursor, data.items.length, perPage),
        }))
      } catch (err) {
        if (signal.aborted || requestId !== loadRequestIdRef.current) return
        if (membershipDirty.current) setPage(prev => ({ ...prev, hasMore: true }))
        reportPhantasiError(err, loadFailed, setError)
      } finally {
        if (!signal.aborted && requestId === loadRequestIdRef.current) {
          loadingRef.current = false
          setItemsLoading(false)
        }
      }
    },
    [loadFailed, setError, viewMode, topicKey],
  )

  useEffect(() => {
    membershipDirty.current = false
    nextCursorRef.current = null
    setPage({ items: [], total: 0, hasMore: true })
    setItemsLoading(false)
    void loadItems(true)
    return () => {
      turns.current.cancel()
      loadRequestIdRef.current++
      loadingRef.current = false
    }
  }, [loadItems])

  useEffect(() => {
    if (viewMode !== 'starred') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = flags.subscribeMutations((_id, patch) => {
      if (typeof patch.is_starred !== 'boolean') return
      invalidateMembership()
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void loadItems(true) }, 100)
    })
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [viewMode, loadItems, invalidateMembership])

  const loadMore = useCallback(() => {
    if (itemsLoading || (!hasMore && !membershipDirty.current)) return
    void loadItems(false)
  }, [hasMore, itemsLoading, loadItems])

  // Commands may finish after navigation; refresh the query that owns this list now.
  const loadItemsRef = useRef(loadItems)
  loadItemsRef.current = loadItems
  const reload = useCallback(() => loadItemsRef.current(true), [])
  const removeItem = useCallback((id: number) => {
    invalidateMembership()
    setPage(prev => {
      const next = prev.items.filter(item => item.id !== id)
      if (next.length === prev.items.length) return prev
      return { ...prev, items: next, total: Math.max(0, prev.total - 1) }
    })
  }, [invalidateMembership])
  const updateTopic = useCallback((id: number, topic: string | null) => {
    const query = queryRef.current
    if (query.viewMode === 'topic-feed' && topic !== query.topicKey) {
      removeItem(id)
      return
    }
    invalidateMembership()
    setPage(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, topic } : item),
    }))
  }, [invalidateMembership, removeItem])

  return {
    items,
    itemsRef,
    itemsLoading,
    hasMore,
    total,
    reload,
    removeItem,
    updateTopic,
    loadMore,
  }
}
