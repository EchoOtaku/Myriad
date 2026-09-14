import type { PhantasiSource } from '../../types/phantasi'
import type {
  PhantasiBoard,
  PhantasiBoardEntry,
  PhantasiViewMode,
  WorkbenchPane,
} from './logic/board'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  eatSearchKeys,
  navIdForBoardEntry,
  resolveBoardParam,
  resolveWorkbenchPane,
  viewForBoardEntry,
} from './logic/board'
import { normalizeTopicName } from './logic/topics'

export function usePhantasiBoardRoute(
  isAuthenticated: boolean,
  isAdmin: boolean,
  sources: PhantasiSource[],
  activeId: string,
  setActiveId: (id: string) => void,
  searchParams: URLSearchParams,
  setSearchParams: (
    next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
    opts?: { replace?: boolean },
  ) => void,
) {
  const [viewMode, setViewMode] = useState<PhantasiViewMode>('sources')
  const [board, setBoard] = useState<PhantasiBoard>('feeds')
  const [selectedTopic, setSelectedTopic] = useState<{
    key: string
  } | null>(null)
  const [railFocusId, setRailFocusId] = useState<number | null>(null)
  const [workbenchPane, setWorkbenchPane] = useState<WorkbenchPane>('home')

  const applyBoardEntry = useCallback(
    (entry: PhantasiBoardEntry) => {
      const view = viewForBoardEntry(entry, isAuthenticated, isAdmin)
      if (entry.view === 'workbench') {
        if (view === 'workbench') {
          setViewMode('workbench')
          return
        }
        setBoard('feeds')
        setViewMode('sources')
        return
      }
      setBoard(entry.board)
      setViewMode(view)
    },
    [isAuthenticated, isAdmin],
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
    if (isAdmin) return
    setViewMode((current) => (current === 'workbench' ? 'sources' : current))
    if (activeId !== 'workbench') return
    prevActiveIdRef.current = 'feeds'
    setActiveId('feeds')
  }, [isAdmin, activeId, setActiveId])

  useEffect(() => {
    const raw = searchParams.get('board') ?? searchParams.get('category')
    if (!raw) return
    const entry = resolveBoardParam(raw)
    if (!entry) return

    applyBoardEntry(entry)
    if (entry.view === 'workbench') {
      setWorkbenchPane(resolveWorkbenchPane(searchParams.get('pane')))
    }
    const navId = navIdForBoardEntry(entry, isAuthenticated, isAdmin)
    prevActiveIdRef.current = navId
    setActiveId(navId)
    setSearchParams(
      (prev) => eatSearchKeys(prev, ['board', 'category', 'pane']),
      { replace: true },
    )
  }, [
    searchParams,
    applyBoardEntry,
    isAuthenticated,
    isAdmin,
    setActiveId,
    setSearchParams,
  ])

  const openTopic = useCallback((topicKey: string) => {
    const key = normalizeTopicName(topicKey)
    if (!key) return
    setSelectedTopic({ key })
    setViewMode('topic-feed')
  }, [])

  const focusSource = useCallback(
    (source: PhantasiSource) => {
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
      openTopic(topicParam)
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
    workbenchPane,
    setWorkbenchPane,
    openTopic,
    focusSource,
    backFromTopic,
    backToFeeds,
  }
}
