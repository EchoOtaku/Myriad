/** skin 不进口。 */
import type {
  AddSourceInput,
  PhantasiSource,
  PhantasiStats,
  UpdateSourceRequest,
} from '../../types/phantasi'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as phantasiApi from '../../services/phantasiApi'
import { phantasiItemState } from '../../utils/phantasiItemState'
import { reportPhantasiError } from './phantasiNotice'
import { RequestTurn } from './logic/requestTurn'

function applyReadMutation(
  source: PhantasiSource,
  itemId: number,
  isRead: boolean,
  sourceId?: number,
): PhantasiSource {
  if (itemId === 0) {
    if (
      source.unread_count === 0 &&
      !source.recent_items?.some((item) => !item.is_read)
    ) {
      return source
    }
    return {
      ...source,
      unread_count: 0,
      recent_items: source.recent_items?.map((item) =>
        item.is_read ? item : { ...item, is_read: true },
      ),
    }
  }
  const belongs =
    sourceId === source.id ||
    Boolean(source.recent_items?.some((item) => item.id === itemId))
  if (!belongs) return source
  const hit = source.recent_items?.find((item) => item.id === itemId)
  if (hit?.is_read === isRead) return source
  return {
    ...source,
    unread_count: Math.max(0, source.unread_count + (isRead ? -1 : 1)),
    recent_items: source.recent_items?.map((item) =>
      item.id === itemId ? { ...item, is_read: isRead } : item,
    ),
  }
}

export function usePhantasiSources(
  isAuthenticated: boolean,
  labels: { loadFailed: string; refreshFailed: string },
  setError: (message: string) => void,
) {
  const [sources, setSources] = useState<PhantasiSource[]>([])
  const [sourcesLoaded, setSourcesLoaded] = useState(false)
  const [stats, setStats] = useState<PhantasiStats | null>(null)
  const [booting, setBooting] = useState(true)

  const sourceRequest = useRef(0)
  const statsRequest = useRef(0)
  const sourceTurns = useRef(new RequestTurn())
  const statsTurns = useRef(new RequestTurn())

  const loadSources = useCallback(async () => {
    const request = ++sourceRequest.current
    const signal = sourceTurns.current.begin()
    try {
      const data = await phantasiApi.getSources(undefined, { signal })
      if (signal.aborted || request !== sourceRequest.current) return
      setSourcesLoaded(true)
      setSources(data)
    } catch (err) {
      if (signal.aborted || request !== sourceRequest.current) return
      reportPhantasiError(err, labels.loadFailed, setError)
    }
  }, [labels.loadFailed, setError])

  const loadStats = useCallback(async () => {
    const request = ++statsRequest.current
    const signal = statsTurns.current.begin()
    try {
      const next = await phantasiApi.getStats(undefined, { signal })
      if (signal.aborted || request !== statsRequest.current) return
      setStats(next)
    } catch (err) {
      if (signal.aborted || request !== statsRequest.current) return
      console.error('Failed to load stats:', err)
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = phantasiItemState.subscribeMutations((id, patch, sourceId) => {
      statsTurns.current.cancel()
      statsRequest.current++
      if (typeof patch.is_read === 'boolean') {
        setSources((prev) =>
          prev.map((source) =>
            applyReadMutation(source, id, patch.is_read!, sourceId),
          ),
        )
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void loadStats()
      }, 100)
    })
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [loadSources, loadStats])

  useEffect(() => {
    let cancelled = false
    setBooting(true)
    void Promise.all([loadSources(), loadStats()]).finally(() => {
      if (!cancelled) setBooting(false)
    })
    return () => {
      cancelled = true
      sourceTurns.current.cancel()
      statsTurns.current.cancel()
      sourceRequest.current++
      statsRequest.current++
    }
  }, [loadSources, loadStats])

  const refreshRef = useRef(() => {})
  refreshRef.current = () => {
    void loadSources()
    void loadStats()
  }

  useEffect(() => {
    if (!isAuthenticated) return
    let closed = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      try {
        ws = phantasiApi.createPhantasiWebSocket(
          () => {
            refreshRef.current()
          },
          () => {
            if (closed) return
            reconnectTimer = setTimeout(connect, 5000)
          },
        )
        ws.onclose = () => {
          if (closed) return
          reconnectTimer = setTimeout(connect, 5000)
        }
      } catch (err) {
        console.warn('[Phantasi] WS connect failed', err)
        reconnectTimer = setTimeout(connect, 8000)
      }
    }
    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
    }
  }, [isAuthenticated])

  const reloadBoard = useCallback(() => {
    void loadSources()
    void loadStats()
  }, [loadSources, loadStats])

  const updateSource = useCallback(
    async (id: number, data: UpdateSourceRequest) => {
      const updated = await phantasiApi.updateSource(id, data)
      setSources((prev) =>
        prev.map((source) => (source.id === id ? updated : source)),
      )
      void loadStats()
    },
    [loadStats],
  )

  const importOpml = useCallback(
    async (content: string, signal?: AbortSignal) => {
      const result = await phantasiApi.importOpml(
        content,
        undefined,
        signal ? { signal } : undefined,
      )
      if (!signal?.aborted) reloadBoard()
      return {
        imported: result.imported || 0,
        skipped: result.skipped || 0,
      }
    },
    [reloadBoard],
  )

  const removeSources = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return
      const named = new Map(sources.map((source) => [source.id, source.name]))
      const results = await Promise.allSettled(
        ids.map((id) => phantasiApi.deleteSource(id)),
      )
      const dropped = ids.filter((_, index) => results[index]?.status === 'fulfilled')
      if (dropped.length > 0) {
        const gone = new Set(dropped)
        setSources((prev) =>
          Iterator.from(prev)
            .filter((source) => !gone.has(source.id))
            .toArray(),
        )
        void loadStats()
      }
      const failed = ids.filter((_, index) => results[index]?.status === 'rejected')
      if (failed.length > 0) {
        const names = failed
          .map((id) => named.get(id)?.trim() || `#${id}`)
          .join('、')
        throw new Error(names)
      }
    },
    [loadStats, sources],
  )

  const addSource = useCallback(
    async ({
      url,
      name,
      category,
      icon,
      sourceType,
      feedType,
      notionToken,
    }: AddSourceInput) => {
      const source = await phantasiApi.addSource({
        url,
        name,
        category,
        source_type: sourceType,
        feed_type: feedType,
        extra_config: notionToken ? { token: notionToken } : undefined,
      })
      if (icon && source.id) {
        const updated = await phantasiApi.updateSource(source.id, { icon })
        setSources((prev) => [...prev, updated])
      } else {
        setSources((prev) => [...prev, source])
      }
      void loadStats()
    },
    [loadStats],
  )

  const discoverSource = useCallback(
    async (url: string, signal?: AbortSignal) => {
      return phantasiApi.discoverSource(url.trim(), undefined, { signal })
    },
    [],
  )

  const generateStyleTags = useCallback(
    async (sourceId: number, signal?: AbortSignal) => {
      return phantasiApi.generateStyleTags(sourceId, signal)
    },
    [],
  )

  const refreshSource = useCallback(
    async (sourceId: number) => {
      try {
        const newCount = await phantasiApi.refreshSource(sourceId)
        if (newCount > 0) reloadBoard()
      } catch (err) {
        reportPhantasiError(err, labels.refreshFailed, setError)
      }
    },
    [reloadBoard, labels.refreshFailed, setError],
  )

  const refreshSources = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return
      try {
        await phantasiApi.refreshSources(ids)
        reloadBoard()
      } catch (err) {
        reportPhantasiError(err, labels.refreshFailed, setError)
      }
    },
    [reloadBoard, labels.refreshFailed, setError],
  )

  return {
    sources,
    setSources,
    sourcesLoaded,
    stats,
    setStats,
    booting,
    loadSources,
    loadStats,
    reloadBoard,
    addSource,
    updateSource,
    importOpml,
    removeSources,
    refreshSource,
    refreshSources,
    discoverSource,
    generateStyleTags,
  }
}
