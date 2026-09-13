import type { BrewSource } from '../../types/brew'
import type { BrewBoard, BrewBoardEntry, BrewViewMode } from './logic/board'

import type { TopicNameKey } from './logic/topics'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  eatSearchKeys,
  navIdForBoardEntry,
  resolveBoardParam,
  viewForBoardEntry,
} from './logic/board'
import { topicNameKey } from './logic/topics'

export function useBrewBoardRoute(
  isAuthenticated: boolean,
  sources: BrewSource[],
  activeId: string,
  setActiveId: (id: string) => void,
  searchParams: URLSearchParams,
  setSearchParams: (
    next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
    opts?: { replace?: boolean },
  ) => void,
) {
  const [viewMode, setViewMode] = useState<BrewViewMode>('sources')
  const [board, setBoard] = useState<BrewBoard>('feeds')
  const [selectedTopic, setSelectedTopic] = useState<{
    key: string
    nameKey: TopicNameKey
  } | null>(null)
  const [railFocusId, setRailFocusId] = useState<number | null>(null)

  const applyBoardEntry = useCallback(
    (entry: BrewBoardEntry) => {
      setBoard(entry.board)
      setViewMode(viewForBoardEntry(entry, isAuthenticated))
    },
    [isAuthenticated],
  )

  const prevActiveIdRef = useRef(activeId)
  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return
    prevActiveIdRef.current = activeId
    const entry = resolveBoardParam(activeId)
    if (entry) applyBoardEntry(entry)
  }, [activeId, applyBoardEntry])

  useEffect(() => {
    if (isAuthenticated) return
    setViewMode((current) => (current === 'starred' ? 'sources' : current))
    if (activeId !== 'starred') return
    prevActiveIdRef.current = 'feeds'
    setActiveId('feeds')
  }, [isAuthenticated, activeId, setActiveId])

  useEffect(() => {
    const raw = searchParams.get('board') ?? searchParams.get('category')
    if (!raw) return
    const entry = resolveBoardParam(raw)
    if (!entry) return

    applyBoardEntry(entry)
    const navId = navIdForBoardEntry(entry, isAuthenticated)
    prevActiveIdRef.current = navId
    setActiveId(navId)
    setSearchParams((prev) => eatSearchKeys(prev, ['board', 'category']), {
      replace: true,
    })
  }, [
    searchParams,
    applyBoardEntry,
    isAuthenticated,
    setActiveId,
    setSearchParams,
  ])

  const openTopic = useCallback((topicKey: string, nameKey: TopicNameKey) => {
    setSelectedTopic({ key: topicKey, nameKey })
    setViewMode('topic-feed')
  }, [])

  const focusSource = useCallback(
    (source: BrewSource) => {
      setBoard('feeds')
      setViewMode('sources')
      setActiveId('feeds')
      setRailFocusId(source.id)
    },
    [setActiveId],
  )

  useEffect(() => {
    const topicParam = searchParams.get('topic')
    if (topicParam) {
      const nameKey = topicNameKey(topicParam)
      if (nameKey) openTopic(topicParam, nameKey)
      setSearchParams((prev) => eatSearchKeys(prev, ['topic']), {
        replace: true,
      })
      return
    }

    const sourceParam = searchParams.get('source')
    if (!sourceParam) return
    const id = Number(sourceParam)
    if (!Number.isFinite(id)) return
    const target = sources.find((source) => source.id === id)
    if (!target) return

    focusSource(target)
    setSearchParams((prev) => eatSearchKeys(prev, ['source']), {
      replace: true,
    })
  }, [searchParams, sources, openTopic, focusSource, setSearchParams])

  const backFromTopic = useCallback(() => {
    setSelectedTopic(null)
    setViewMode('sources')
  }, [])

  const backToFeeds = useCallback(() => {
    setBoard('feeds')
    setViewMode('sources')
    setActiveId('feeds')
  }, [setActiveId])

  return {
    viewMode,
    setViewMode,
    board,
    selectedTopic,
    railFocusId,
    openTopic,
    focusSource,
    backFromTopic,
    backToFeeds,
  }
}
