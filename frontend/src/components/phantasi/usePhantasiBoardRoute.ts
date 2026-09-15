import type { PhantasiSource } from '../../types/phantasi'
import type {
  PhantasiBoard,
  PhantasiBoardEntry,
  PhantasiViewMode,
  WorkbenchPane,
} from './logic/board'
import type { JournalLocation } from './logic/journalRoutes'

import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveBoardParam, viewForBoardEntry } from './logic/board'
import {
  JOURNAL_ROOT,
  WORKBENCH_PANE_PATHS,
  journalListPath,
  journalPathForNavId,
  journalSourcePath,
  journalTopicPath,
  navIdForJournalLocation,
  parseJournalPath,
  pathShowsNavId,
} from './logic/journalRoutes'
import { normalizeTopicName } from './logic/topics'

function applyLocationState(
  loc: JournalLocation,
  applyBoardEntry: (entry: PhantasiBoardEntry) => void,
  setSelectedTopic: (topic: { key: string } | null) => void,
  setRailFocusId: (id: number | null) => void,
  setWorkbenchPane: (pane: WorkbenchPane) => void,
  setViewMode: (view: PhantasiViewMode) => void,
) {
  if (loc.kind === 'article') return
  if (loc.kind === 'workbench') {
    applyBoardEntry({ view: 'workbench', board: 'feeds' })
    setWorkbenchPane(loc.pane)
    setSelectedTopic(null)
    setRailFocusId(null)
    return
  }
  if (loc.kind === 'starred') {
    applyBoardEntry({ view: 'starred', board: 'feeds' })
    setSelectedTopic(null)
    setRailFocusId(null)
    return
  }
  if (loc.kind === 'topic') {
    const key = normalizeTopicName(loc.topic)
    applyBoardEntry({ view: 'sources', board: 'feeds' })
    if (key) {
      setSelectedTopic({ key })
      setViewMode('topic-feed')
    }
    setRailFocusId(null)
    return
  }
  if (loc.kind === 'source') {
    applyBoardEntry({ view: 'sources', board: 'feeds' })
    setSelectedTopic(null)
    setRailFocusId(loc.sourceId)
    return
  }
  if (loc.kind === 'notes') {
    applyBoardEntry({ view: 'sources', board: 'notes' })
    setSelectedTopic(null)
    setRailFocusId(null)
    return
  }
  if (loc.kind === 'friends') {
    applyBoardEntry({ view: 'sources', board: 'sites' })
    setSelectedTopic(null)
    setRailFocusId(null)
    return
  }
  applyBoardEntry({ view: 'sources', board: 'feeds' })
  setSelectedTopic(null)
  setRailFocusId(null)
}

export function usePhantasiBoardRoute(
  isAuthenticated: boolean,
  isAdmin: boolean,
  _sources: PhantasiSource[],
  activeId: string,
  setActiveId: (id: string) => void,
  pathname: string,
  navigate: (to: string, opts?: { replace?: boolean }) => void,
) {
  const [viewMode, setViewMode] = useState<PhantasiViewMode>('sources')
  const [board, setBoard] = useState<PhantasiBoard>('feeds')
  const [selectedTopic, setSelectedTopic] = useState<{
    key: string
  } | null>(null)
  const [railFocusId, setRailFocusId] = useState<number | null>(null)
  const [workbenchPane, setWorkbenchPaneState] = useState<WorkbenchPane>('home')
  const prevActiveIdRef = useRef(activeId)

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

  const applyBoardEntryRef = useRef(applyBoardEntry)
  applyBoardEntryRef.current = applyBoardEntry

  useEffect(() => {
    const loc = parseJournalPath(pathname)
    if (!loc || loc.kind === 'article') return

    if (loc.kind === 'starred' && !isAuthenticated) {
      navigate(JOURNAL_ROOT, { replace: true })
      return
    }
    if (loc.kind === 'workbench' && !isAdmin) {
      navigate(JOURNAL_ROOT, { replace: true })
      return
    }

    applyLocationState(
      loc,
      applyBoardEntryRef.current,
      setSelectedTopic,
      setRailFocusId,
      setWorkbenchPaneState,
      setViewMode,
    )

    const navId = navIdForJournalLocation(loc, isAuthenticated, isAdmin)
    prevActiveIdRef.current = navId
    setActiveId(navId)
  }, [pathname, isAuthenticated, isAdmin, setActiveId, navigate])

  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return
    prevActiveIdRef.current = activeId
    const entry = resolveBoardParam(activeId)
    if (entry) applyBoardEntry(entry)
    if (!pathShowsNavId(pathname, activeId)) {
      navigate(journalPathForNavId(activeId))
    }
  }, [activeId, applyBoardEntry, navigate, pathname])

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

  const openTopic = useCallback(
    (topicKey: string) => {
      const key = normalizeTopicName(topicKey)
      if (!key) return
      navigate(journalTopicPath(key))
    },
    [navigate],
  )

  const focusSource = useCallback(
    (source: PhantasiSource | null) => {
      if (!source) {
        setRailFocusId(null)
        navigate(JOURNAL_ROOT)
        return
      }
      setRailFocusId(source.id)
      navigate(journalSourcePath(source.id))
    },
    [navigate],
  )

  const backFromTopic = useCallback(() => {
    navigate(JOURNAL_ROOT)
  }, [navigate])

  const backToFeeds = useCallback(() => {
    navigate(JOURNAL_ROOT)
  }, [navigate])

  const setWorkbenchPane = useCallback(
    (pane: WorkbenchPane) => {
      setWorkbenchPaneState(pane)
      navigate(WORKBENCH_PANE_PATHS[pane])
    },
    [navigate],
  )

  const listPath = journalListPath({
    viewMode,
    board,
    topic: selectedTopic?.key,
    sourceId: viewMode === 'sources' ? railFocusId : null,
    workbenchPane,
  })

  return {
    viewMode,
    setViewMode,
    board,
    selectedTopic,
    railFocusId,
    workbenchPane,
    setWorkbenchPane,
    listPath,
    openTopic,
    focusSource,
    backFromTopic,
    backToFeeds,
  }
}
