import type { BoardScroll } from '../components/phantasi/logic/boardScroll'

import type { PhantasiItem } from '../types/phantasi'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  useLocation,
  useMatch,
  useNavigate,
} from 'react-router-dom'
import {
  cancelArticlePrefetch,
  prefetchArticleDetails,
} from '../components/phantasi/articlePrefetch'
import { phantasiBoardNavItems } from '../components/phantasi/boardNav'
import {
  BOARD_NAV_VISIBILITY_CHANGED,
  filterBoardNavItems,
  readBoardNavVisibility,
} from '../components/phantasi/logic/boardNavVisibility'
import PhantasiFilterLane from '../components/phantasi/PhantasiFilterLane'
import PhantasiSourceGrid from '../components/phantasi/PhantasiSourceGrid'
import { journalItemPath } from '../components/phantasi/logic/journalRoutes'
import { storySourceFace } from '../components/phantasi/notes/noteSiteSource'
import {
  PHANTASI_PEEK_HANDOFF_MS,
  PhantasiPeekAir,
  readPeekFace,
  subscribePeekFace,
  toPhantasiPeekFace,
  writePeekFace,
} from '../components/phantasi/ui/PhantasiPeekAir'
import {
  notePeekPointer,
  peekLaneIsSwapping,
  peekNodeFromPoint,
  peekPointerMoving,
  peekPointerWantsAir,
} from '../components/phantasi/ui/peekLane'
import {
  onPhantasiMotion,
  phantasiMotionBusy,
} from '../hooks/animation/pages/phantasiMotion'
import {
  cancelPhantasiPeekResume,
  clearPhantasiStoryPeeks,
  resumePhantasiStoryPeek,
  schedulePhantasiPeekResume,
} from '../components/phantasi/ui/StoryCard'
import {
  filterItemsByQuery,
  filterLaneItems,
  showsFilterLane,
} from '../components/phantasi/logic/board'
import {
  captureBoardScroll,
  restoreBoardScroll,
} from '../components/phantasi/logic/boardScroll'
import { shouldPopOpenedItem } from '../components/phantasi/logic/phantasiItemRoute'
import { topicDisplayName } from '../components/phantasi/logic/topics'
import { PhantasiViewLane } from '../components/phantasi/skin/PhantasiChip'
import { AnimatePresence, PhantasiPage } from '../components/phantasi/skin/PhantasiPage'
import {
  PhantasiSearch,
  phantasiSearchInputRef,
  showPhantasiSearchGuide,
} from '../components/phantasi/ui/PhantasiSearch'
import { usePhantasiAgentOpen } from '../components/phantasi/usePhantasiAgentOpen'
import { usePhantasiBoardRoute } from '../components/phantasi/usePhantasiBoardRoute'
import { usePhantasiItemActions } from '../components/phantasi/usePhantasiItemActions'
import { usePhantasiItemRoute } from '../components/phantasi/usePhantasiItemRoute'
import { usePhantasiItems } from '../components/phantasi/usePhantasiItems'
import { usePhantasiNavExpand } from '../components/phantasi/usePhantasiNavExpand'
import { usePhantasiNotes } from '../components/phantasi/usePhantasiNotes'
import { usePhantasiSeo } from '../components/phantasi/usePhantasiSeo'
import { usePhantasiSources } from '../components/phantasi/usePhantasiSources'
import { usePhantasiStarred } from '../components/phantasi/usePhantasiStarred'
import { usePhantasiSurface } from '../components/phantasi/usePhantasiSurface'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import { useSecondaryNav } from '../contexts/NavigationContext'
import { useReadingListOptional } from '../contexts/ReadingListContext'
import { cancelIdleTask, scheduleIdleTask } from '../hooks/animation'
import { usePhantasiKeyboard } from '../hooks/usePhantasiKeyboard'
import { phantasiSubject } from '../utils/phantasiSubject'
import {
  canAccessModuleVisibility,
  useModuleVisibilityPreferences,
} from '../utils/moduleVisibility'
import { showToast } from '../utils/toastManager'

const PhantasiReader = lazy(() => import('../components/phantasi/PhantasiReader'))
const NoteEditor = lazy(() => import('../components/phantasi/notes/NoteEditor'))
const PhantasiWorkbenchLane = lazy(() => import('../components/phantasi/PhantasiWorkbenchLane'))

function warmJournalSurfaces(admin: boolean) {
  void import('../components/phantasi/PhantasiReader')
  if (!admin) return
  void import('../components/phantasi/notes/NoteEditor')
  void import('../components/phantasi/PhantasiWorkbenchLane')
}

const EMPTY_ITEMS: PhantasiItem[] = []

export default function Phantasi() {
  const subject = useSyncExternalStore(
    phantasiSubject.subscribe,
    phantasiSubject.getSnapshot,
    phantasiSubject.getSnapshot,
  )
  const peekFace = useSyncExternalStore(
    subscribePeekFace,
    readPeekFace,
    readPeekFace,
  )
  const { hasChecked } = useAuth()
  useEffect(() => {
    if (hasChecked && !subject.active) writePeekFace(null)
  }, [hasChecked, subject.active])
  useEffect(() => () => writePeekFace(null), [])
  return (
    <>
      <PhantasiPeekAir face={peekFace} />
      {!hasChecked || !subject.active ? (
        <PhantasiPage lock={false} loading />
      ) : (
        <PhantasiSubjectPage key={subject.generation} />
      )}
    </>
  )
}

function PhantasiSubjectPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const itemIdParam =
    useMatch('/journal/articles/:itemId')?.params.itemId
  const { preferences: moduleVisibility } = useModuleVisibilityPreferences()
  const moduleOpenToAll = canAccessModuleVisibility(
    moduleVisibility.modules.phantasi,
    { isAuthenticated: false, isAdmin: false },
  )
  const { isAuthenticated, isAdmin, user } = useAuth()
  const readingList = useReadingListOptional()
  const setError = useCallback((message: string) => {
    showToast({ message, type: 'error', replaceKey: 'phantasi-page' })
  }, [])

  const sources = usePhantasiSources(
    isAuthenticated,
    {
      loadFailed: t.phantasi.loadSourcesFailed,
      refreshFailed: t.errors.phantasiRefreshFailed,
    },
    setError,
  )

  const [boardNavVisibility, setBoardNavVisibility] = useState(
    readBoardNavVisibility,
  )
  useEffect(() => {
    const sync = () => setBoardNavVisibility(readBoardNavVisibility())
    window.addEventListener(BOARD_NAV_VISIBILITY_CHANGED, sync)
    return () => window.removeEventListener(BOARD_NAV_VISIBILITY_CHANGED, sync)
  }, [])
  const navItems = useMemo(
    () =>
      filterBoardNavItems(
        phantasiBoardNavItems(t.phantasi, {
          includeStarred: isAdmin,
          includeWorkbench: isAdmin,
        }),
        boardNavVisibility,
        moduleVisibility.modules.phantasi,
        { isAuthenticated, isAdmin },
      ),
    [
      t.phantasi,
      isAuthenticated,
      isAdmin,
      boardNavVisibility,
      moduleVisibility.modules.phantasi,
    ],
  )
  const { activeId, setActiveId, setExpanded } = useSecondaryNav({
    routePath: '/journal',
    items: navItems,
    defaultActiveId: 'feeds',
    expandHint: t.phantasi.expandMenu,
  })
  usePhantasiNavExpand(setExpanded)

  const route = usePhantasiBoardRoute(
    isAuthenticated,
    isAdmin,
    sources.sources,
    activeId,
    setActiveId,
    location.pathname,
    navigate,
  )

  const list = usePhantasiItems(
    t.phantasi.loadArticlesFailed,
    setError,
    route.viewMode,
    route.selectedTopic?.key,
  )
  const starred = usePhantasiStarred(
    list.items,
    list.setItems,
    list.setTotal,
    t.phantasi.starFailed,
    setError,
  )

  const item = usePhantasiItemRoute(
    itemIdParam,
    sources.sources,
    sources.sourcesLoaded,
    navigate,
    setError,
    t.phantasi.loadArticlesFailed,
    route.listPath,
  )

  usePhantasiAgentOpen({
    itemsRef: list.itemsRef,
    openArticle: item.openArticle,
    setItems: list.setItems,
    setTotal: list.setTotal,
    setError,
    webSearchLabel: t.phantasi.webSearch,
    loadFailed: t.phantasi.loadArticlesFailed,
  })

  const actions = usePhantasiItemActions({
    isAuthenticated,
    openArticle: item.openArticle,
    viewMode: route.viewMode,
    board: route.board,
    selectedItem: item.selectedItem,
    setItems: list.setItems,
    setTotal: list.setTotal,
    setError,
    itemsRef: list.itemsRef,
    unselectStarred: starred.unselect,
    navigate,
    readingList,
    labels: {
      starFailed: t.phantasi.starFailed,
      readingFailed: t.errors.readingStateFailed,
      loadFailed: t.phantasi.loadArticlesFailed,
      webSearch: t.phantasi.webSearch,
    },
  })

  const notes = usePhantasiNotes(
    item.selectedItem,
    item.setSelectedItem,
    list.setItems,
    route.viewMode,
    route.selectedTopic?.key,
    list.loadItems,
    sources.reloadBoard,
    sources.loadSources,
    sources.loadStats,
  )
  usePhantasiSeo(
    item.selectedItem,
    item.selectedItemSource,
    item.selectedItemOwnState,
    moduleOpenToAll,
    t.nav.phantasiReading || t.nav.phantasi,
    t.widgets.phantasiDesc,
    route.listPath,
    route.viewMode,
  )

  useEffect(() => {
    if (!item.opening) return
    showToast({
      message: t.common.loading,
      type: 'info',
      replaceKey: 'phantasi-page',
    })
  }, [item.opening, t.common.loading])

  useEffect(() => {
    if (route.viewMode === 'starred') return
    starred.exitEdit()
  }, [route.viewMode, starred.exitEdit])

  const handleBackFromTopic = useCallback(() => {
    item.closeArticle()
    route.backFromTopic()
  }, [item.closeArticle, route.backFromTopic])

  const handleStarredBack = useCallback(() => {
    route.backToFeeds()
    starred.exitEdit()
  }, [route.backToFeeds, starred.exitEdit])

  const handleCloseReader = useCallback(() => {
    const openedId = item.selectedItem?.id
    item.closeArticle()
    if (!itemIdParam) return
    if (shouldPopOpenedItem(location.state, openedId)) navigate(-1)
    else navigate(route.listPath, { replace: true })
  }, [
    itemIdParam,
    item.selectedItem?.id,
    item.closeArticle,
    location.state,
    navigate,
    route.listPath,
  ])

  const boardScroll = useRef<BoardScroll | null>(null)
  const selectedId = item.selectedItem?.id
  useEffect(() => {
    if (selectedId != null) {
      if (!boardScroll.current) boardScroll.current = captureBoardScroll()
      return
    }
    const pos = boardScroll.current
    boardScroll.current = null
    if (!pos) return
    const frame = requestAnimationFrame(() => restoreBoardScroll(pos))
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  const [searchQuery, setSearchQuery] = useState('')
  const [boardHits, setBoardHits] = useState(0)
  const listItems = useMemo(
    () =>
      filterItemsByQuery(
        filterLaneItems(route.viewMode, list.items, EMPTY_ITEMS),
        searchQuery,
      ),
    [list.items, route.viewMode, searchQuery],
  )
  const filterOpen = showsFilterLane(
    route.viewMode,
    !!route.selectedTopic,
    isAuthenticated,
  )
  const showSearch = route.viewMode !== 'workbench'
  const searchHits = filterOpen ? listItems.length : boardHits
  const searchMiss = !!searchQuery.trim() && searchHits === 0

  const topicFeedMode = useMemo(() => {
    if (!route.selectedTopic) return undefined
    return {
      topicKey: route.selectedTopic.key,
      topicLabel: topicDisplayName(route.selectedTopic, t.phantasi),
      total: list.total,
      onBack: handleBackFromTopic,
    }
  }, [route.selectedTopic, list.total, handleBackFromTopic, t.phantasi])

  const starredMode = useMemo(
    () => ({
      total: sources.stats?.total_starred || 0,
      selectedIds: starred.selectedIds,
      isEditMode: starred.editMode,
      onBack: handleStarredBack,
      onEnterEditMode: starred.enterEdit,
      onExitEditMode: starred.exitEdit,
      onSelectAll: starred.selectAll,
      onBatchUnstar: starred.batchUnstar,
      isProcessing: starred.processing,
    }),
    [
      sources.stats?.total_starred,
      starred.selectedIds,
      starred.editMode,
      handleStarredBack,
      starred.enterEdit,
      starred.exitEdit,
      starred.selectAll,
      starred.batchUnstar,
      starred.processing,
    ],
  )

  const handleCardStar = useCallback(
    (preview: { id: number; is_starred?: boolean }) => {
      return actions.toggleStar({
        id: preview.id,
        is_starred: !!preview.is_starred,
      })
    },
    [actions.toggleStar],
  )

  const handleKeyboardSelect = useCallback(
    (next: PhantasiItem | null) => {
      if (next) void actions.select(next)
      else handleCloseReader()
    },
    [actions.select, handleCloseReader],
  )

  const handleReaderStar = useCallback(() => {
    if (item.selectedItem) actions.toggleStar(item.selectedItem)
  }, [item.selectedItem, actions.toggleStar])

  usePhantasiKeyboard({
    items: listItems,
    selectedItem: item.selectedItem,
    enabled: true,
    onSelectItem: handleKeyboardSelect,
    onToggleRead: actions.toggleRead,
    onToggleStar: actions.toggleStar,
    onRefresh: () => {},
    onAddSource: () => {},
    onMarkAllRead: actions.markAllRead,
    onCloseReader: handleCloseReader,
    onShowHelp: showPhantasiSearchGuide,
    searchInputRef: phantasiSearchInputRef,
  })

  usePhantasiSurface(sources.booting, true)

  useEffect(() => {
    if (sources.booting) return
    const run = () => warmJournalSurfaces(isAdmin)
    const idle = window.requestIdleCallback
    if (!idle) {
      const timer = window.setTimeout(run, 1)
      return () => window.clearTimeout(timer)
    }
    const id = idle(run, { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }, [isAdmin, sources.booting])

  const peekFace = useSyncExternalStore(
    subscribePeekFace,
    readPeekFace,
    readPeekFace,
  )
  const peekEndTimer = useRef(0)
  const dropPeekSession = useCallback(() => {
    window.clearTimeout(peekEndTimer.current)
    peekEndTimer.current = 0
    cancelIdleTask('phantasi-peek-warm')
    cancelPhantasiPeekResume()
    cancelArticlePrefetch()
    clearPhantasiStoryPeeks()
    writePeekFace(null)
  }, [])
  const handlePeekItem = useCallback(
    (item: {
      id: number
      title: string
      image?: string | null
      source_name?: string | null
      source_icon?: string | null
      source_type?: string | null
      guid?: string | null
    }) => {
      window.clearTimeout(peekEndTimer.current)
      peekEndTimer.current = 0
      cancelIdleTask('phantasi-peek-warm')
      writePeekFace(toPhantasiPeekFace(item, storySourceFace(item)))
      const id = item.id
      scheduleIdleTask(
        'phantasi-peek-warm',
        () => {
          if (phantasiMotionBusy()) return
          prefetchArticleDetails([id])
          void import('../components/phantasi/PhantasiReader')
        },
        { priority: 'low' },
      )
    },
    [],
  )
  const settlePeekSession = useCallback(() => {
    window.clearTimeout(peekEndTimer.current)
    peekEndTimer.current = window.setTimeout(() => {
      peekEndTimer.current = 0
      if (item.selectedItem || notes.noteEditor !== null) {
        dropPeekSession()
        return
      }
      if (peekPointerWantsAir()) {
        if (peekNodeFromPoint()) {
          resumePhantasiStoryPeek(handlePeekItem)
          return
        }
        if (peekPointerMoving() || peekLaneIsSwapping()) {
          settlePeekSession()
        }
        return
      }
      dropPeekSession()
    }, PHANTASI_PEEK_HANDOFF_MS)
  }, [dropPeekSession, handlePeekItem, item.selectedItem, notes.noteEditor])
  useEffect(() => {
    if (item.selectedItem || notes.noteEditor !== null) dropPeekSession()
  }, [dropPeekSession, item.selectedItem, notes.noteEditor])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') dropPeekSession()
    }
    const onPageHide = () => dropPeekSession()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [dropPeekSession])
  const handlePeekEnd = useCallback(() => {
    settlePeekSession()
  }, [settlePeekSession])
  const resumePeekAfterLane = useCallback(() => {
    if (item.selectedItem || notes.noteEditor !== null) return
    schedulePhantasiPeekResume(handlePeekItem)
  }, [handlePeekItem, item.selectedItem, notes.noteEditor])
  useEffect(() => {
    return onPhantasiMotion((lane) => {
      if (lane !== 'intro' && lane !== 'flip' && lane !== 'lane') return
      window.clearTimeout(peekEndTimer.current)
      peekEndTimer.current = 0
    })
  }, [])
  useEffect(() => {
    if (!peekFace) return
    const onMove = (event: PointerEvent) => {
      notePeekPointer(event)
      settlePeekSession()
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => document.removeEventListener('pointermove', onMove)
  }, [peekFace, settlePeekSession])

  if (sources.booting) {
    return <PhantasiPage lock={false} loading />
  }

  return (
    <PhantasiPage lock>
      {showSearch ? (
        <div
          className="phantasi-search-bar"
          inert={!!item.selectedItem || notes.noteEditor !== null || undefined}
        >
          <PhantasiSearch
            value={searchQuery}
            onChange={setSearchQuery}
            matchCount={searchHits}
          />
        </div>
      ) : null}
      <PhantasiViewLane
        wave={
          route.viewMode === 'topic-feed'
            ? `topic-feed:${route.selectedTopic?.key ?? ''}`
            : route.viewMode === 'workbench'
              ? 'workbench'
              : route.viewMode
        }
        suspended={!!item.selectedItem || notes.noteEditor !== null}
        onDisplayed={resumePeekAfterLane}
      >
        {route.viewMode === 'workbench' && isAdmin ? (
          <Suspense fallback={null}>
            <PhantasiWorkbenchLane
              sources={sources}
              notes={notes}
              openArticle={item.openArticle}
              pane={route.workbenchPane}
              onPane={route.setWorkbenchPane}
              setError={setError}
            />
          </Suspense>
        ) : null}
        {route.viewMode === 'sources' && (
          <PhantasiSourceGrid
            sources={sources.sources}
            board={route.board}
            focusSourceId={route.railFocusId}
            onRailFocus={(sourceId) => {
              if (sourceId == null) {
                route.focusSource(null)
                return
              }
              const source = sources.sources.find((entry) => entry.id === sourceId)
              if (source) route.focusSource(source)
            }}
            onSourceClick={actions.openLatest}
            onRefreshSource={sources.refreshSource}
            onSourcesChange={sources.reloadBoard}
            onAddSource={sources.addSource}
            onUpdateSource={sources.updateSource}
            onDiscoverSource={sources.discoverSource}
            onGenerateStyleTags={sources.generateStyleTags}
            onImportOpml={sources.importOpml}
            onRemoveSources={sources.removeSources}
            onOpenItem={actions.openPreview}
            onPeekItem={handlePeekItem}
            onPeekEnd={handlePeekEnd}
            onToggleStar={handleCardStar}
            onMarkAllRead={isAuthenticated ? actions.markAllRead : undefined}
            onWriteNote={isAdmin ? notes.write : undefined}
            onOpenDoc={isAdmin ? notes.editDoc : undefined}
            docsEpoch={notes.docsEpoch}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            searchQuery={searchQuery}
            onSearchHits={setBoardHits}
          />
        )}

        {filterOpen ? (
          <PhantasiFilterLane
            topicFeedMode={
              route.viewMode === 'topic-feed' ? topicFeedMode : undefined
            }
            starredMode={route.viewMode === 'starred' ? starredMode : undefined}
            items={listItems}
            selectedItem={item.selectedItem}
            loading={list.itemsLoading}
            hasMore={list.hasMore}
            total={list.total}
            onItemSelect={actions.select}
            onLoadMore={list.loadMore}
            onToggleStar={actions.toggleStar}
            onItemSelectToggle={starred.toggle}
            onPeekItem={handlePeekItem}
            onPeekEnd={handlePeekEnd}
            searchMiss={searchMiss}
          />
        ) : null}
      </PhantasiViewLane>

      <AnimatePresence mode="wait">
        {item.selectedItem && (
          <Suspense fallback={null}>
            <PhantasiReader
              key="phantasi-reader"
              item={item.selectedItem}
              onClose={handleCloseReader}
              onToggleStar={handleReaderStar}
              isAuthenticated={isAuthenticated}
              isAdmin={isAdmin}
              currentUserId={user?.id ?? null}
              sourceType={item.selectedItemSource?.source_type}
              onEditNote={
                isAdmin && item.selectedItemSource?.source_type === 'note'
                  ? () => notes.edit(item.selectedItem!.id)
                  : undefined
              }
              shareUrl={
                item.selectedItemIsOwn
                  ? `${typeof window !== 'undefined' ? window.location.origin : ''}${journalItemPath(item.selectedItem.id)}`
                  : undefined
              }
              onNavigateToArticle={actions.navigateToArticle}
              readingQueue={item.queue}
              canEditTopic={
                isAdmin && item.selectedItemSource?.source_type !== 'note'
              }
              onTopicChange={(topic) => {
                const id = item.selectedItem?.id
                if (id == null) return
                item.setSelectedItem((current) =>
                  current?.id === id ? { ...current, topic } : current,
                )
                list.setItems((rows) => {
                  if (
                    route.viewMode === 'topic-feed' &&
                    topic !== route.selectedTopic?.key
                  ) {
                    return rows.filter((row) => row.id !== id)
                  }
                  return rows.map((row) =>
                    row.id === id ? { ...row, topic } : row,
                  )
                })
                sources.reloadBoard()
              }}
            />
          </Suspense>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {notes.noteEditor !== null && (
          <Suspense fallback={null}>
            <NoteEditor
              key={
                notes.noteEditor === 'new'
                  ? 'new'
                  : typeof notes.noteEditor === 'number'
                    ? `item:${notes.noteEditor}`
                    : `doc:${notes.noteEditor.docId}`
              }
              noteId={
                typeof notes.noteEditor === 'number'
                  ? notes.noteEditor
                  : undefined
              }
              docId={
                typeof notes.noteEditor === 'object'
                  ? notes.noteEditor.docId
                  : undefined
              }
              onClose={notes.close}
              onSaved={notes.onSaved}
              onDeleted={notes.onDeleted}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </PhantasiPage>
  )
}
