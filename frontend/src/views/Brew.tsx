import type { BoardScroll } from '../components/brew/logic/boardScroll'

import type { BrewItem } from '../types/brew'
import {
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
  useSearchParams,
} from 'react-router-dom'
import {
  cancelArticlePrefetch,
  prefetchArticleDetails,
} from '../components/brew/articlePrefetch'
import { brewBoardNavItems } from '../components/brew/boardNav'
import BrewFilterLane from '../components/brew/BrewFilterLane'
import BrewReader from '../components/brew/BrewReader'
import BrewSourceGrid from '../components/brew/BrewSourceGrid'
import { brewOwnItemPath } from '../components/brew/constants'
import { storySourceFace } from '../components/brew/notes/noteSiteSource'
import {
  BREW_PEEK_HANDOFF_MS,
  BrewPeekAir,
  toBrewPeekFace,
  type BrewPeekFace,
} from '../components/brew/ui/BrewPeekAir'
import { clearBrewStoryPeeks } from '../components/brew/ui/StoryCard'
import {
  filterLaneItems,
  isSiteSource,
  refreshableSourceCount,
  showsFilterLane,
} from '../components/brew/logic/board'
import {
  captureBoardScroll,
  restoreBoardScroll,
} from '../components/brew/logic/boardScroll'
import { shouldPopOpenedItem } from '../components/brew/logic/brewItemRoute'
import { topicDisplayName } from '../components/brew/logic/topics'
import { BrewCategoryAdmin } from '../components/brew/manager/BrewCategoryAdmin'
import { BrewWorkbenchAdmin } from '../components/brew/manager/BrewWorkbenchAdmin'
import { useBrewpack } from '../components/brew/manager/useBrewpack'
import { useNoteTransfer } from '../components/brew/manager/useNoteTransfer'
import NoteEditor from '../components/brew/notes/NoteEditor'
import { BrewViewLane } from '../components/brew/skin/BrewChip'
import { AnimatePresence, BrewPage } from '../components/brew/skin/BrewPage'
import BrewWorkbench from '../components/brew/skin/BrewWorkbench'
import {
  brewSearchInputRef,
  showBrewSearchGuide,
} from '../components/brew/ui/BrewSearch'
import { useBrewAgentOpen } from '../components/brew/useBrewAgentOpen'
import { useBrewBoardRoute } from '../components/brew/useBrewBoardRoute'
import { useBrewCategories } from '../components/brew/useBrewCategories'
import { useBrewItemActions } from '../components/brew/useBrewItemActions'
import { useBrewItemRoute } from '../components/brew/useBrewItemRoute'
import { useBrewItems } from '../components/brew/useBrewItems'
import { useBrewNavExpand } from '../components/brew/useBrewNavExpand'
import { useBrewNotes } from '../components/brew/useBrewNotes'
import { useBrewSeo } from '../components/brew/useBrewSeo'
import { useBrewSources } from '../components/brew/useBrewSources'
import { useBrewStarred } from '../components/brew/useBrewStarred'
import { useBrewSurface } from '../components/brew/useBrewSurface'
import { useBrewWorkbench } from '../components/brew/useBrewWorkbench'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import { useSecondaryNav } from '../contexts/NavigationContext'
import { useReadingListOptional } from '../contexts/ReadingListContext'
import { useBrewScheduler } from '../hooks/animation'
import { useBrewKeyboard } from '../hooks/useBrewKeyboard'
import { brewSubject } from '../utils/brewSubject'
import {
  canAccessModuleVisibility,
  useModuleVisibilityPreferences,
} from '../utils/moduleVisibility'
import { showToast } from '../utils/toastManager'
import { userFacingError } from '../utils/userFacingError'

const EMPTY_ITEMS: BrewItem[] = []

export default function Brew() {
  const subject = useSyncExternalStore(
    brewSubject.subscribe,
    brewSubject.getSnapshot,
    brewSubject.getSnapshot,
  )
  const { hasChecked } = useAuth()
  if (!hasChecked || !subject.active) return <BrewPage lock={false} loading />
  return <BrewSubjectPage key={subject.generation} />
}

function BrewSubjectPage() {
  useBrewScheduler()
  const { t, format } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const itemIdParam = useMatch('/brew/item/:itemId')?.params.itemId
  const [searchParams, setSearchParams] = useSearchParams()
  const { preferences: moduleVisibility } = useModuleVisibilityPreferences()
  const moduleOpenToAll = canAccessModuleVisibility(
    moduleVisibility.modules.brew,
    { isAuthenticated: false, isAdmin: false },
  )
  const { isAuthenticated, isAdmin } = useAuth()
  const readingList = useReadingListOptional()
  const setError = useCallback((message: string) => {
    showToast({ message, type: 'error', replaceKey: 'brew-page' })
  }, [])

  const sources = useBrewSources(
    isAuthenticated,
    {
      loadFailed: t.brew.loadSourcesFailed,
      refreshFailed: t.errors.brewRefreshFailed,
    },
    setError,
  )

  const navItems = useMemo(
    () =>
      brewBoardNavItems(t.brew, {
        includeStarred: isAuthenticated,
        includeWorkbench: isAdmin,
      }),
    [t.brew, isAuthenticated, isAdmin],
  )
  const { activeId, setActiveId, setExpanded } = useSecondaryNav({
    routePath: '/brew',
    items: navItems,
    defaultActiveId: 'feeds',
    expandHint: t.brew.expandMenu,
  })
  useBrewNavExpand(setExpanded)

  const route = useBrewBoardRoute(
    isAuthenticated,
    isAdmin,
    sources.sources,
    activeId,
    setActiveId,
    searchParams,
    setSearchParams,
  )

  const list = useBrewItems(
    t.brew.loadArticlesFailed,
    setError,
    route.viewMode,
    route.selectedTopic?.key,
  )
  const starred = useBrewStarred(
    list.items,
    list.setItems,
    list.setTotal,
    t.brew.starFailed,
    setError,
  )

  const item = useBrewItemRoute(
    itemIdParam,
    sources.sources,
    sources.sourcesLoaded,
    navigate,
    setError,
    t.brew.loadArticlesFailed,
  )

  useBrewAgentOpen({
    itemsRef: list.itemsRef,
    openArticle: item.openArticle,
    setItems: list.setItems,
    setTotal: list.setTotal,
    setError,
    webSearchLabel: t.brew.webSearch,
    loadFailed: t.brew.loadArticlesFailed,
  })

  const actions = useBrewItemActions({
    isAuthenticated,
    openArticle: item.openArticle,
    viewMode: route.viewMode,
    selectedItem: item.selectedItem,
    setItems: list.setItems,
    setTotal: list.setTotal,
    setError,
    itemsRef: list.itemsRef,
    unselectStarred: starred.unselect,
    navigate,
    readingList,
    labels: {
      starFailed: t.brew.starFailed,
      readingFailed: t.errors.readingStateFailed,
      loadFailed: t.brew.loadArticlesFailed,
      webSearch: t.brew.webSearch,
    },
  })

  const notes = useBrewNotes(
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
  const pack = useBrewpack(sources.sources, sources.reloadBoard)
  const workbench = useBrewWorkbench(
    isAdmin && route.viewMode === 'workbench',
    notes.docsEpoch,
    {
      loadFailed: t.brew.workbenchLoadFailed,
      noteDeleteFailed: t.errors.operationFailed,
      unscheduleFailed: t.brew.workbenchUnscheduleFailed,
      mediaLoadFailed: t.errors.mediaLoadFailed,
      mediaUploadFailed: t.errors.mediaUploadFailed,
      mediaDeleteFailed: t.errors.mediaDeleteFailed,
    },
    setError,
  )
  const categories = useBrewCategories(
    isAdmin && route.viewMode === 'workbench',
    workbench.docs,
    sources.sources,
    {
      loadFailed: t.brew.workbenchCategoryLoadFailed,
      createFailed: t.brew.workbenchCategoryCreateFailed,
      renameFailed: t.brew.workbenchCategoryRenameFailed,
      deleteFailed: t.brew.workbenchCategoryDeleteFailed,
      assignFailed: t.brew.workbenchAssignCategoryFailed,
      categoryFull: t.brew.workbenchCategoryFull,
      untitled: t.brew.workbenchNoteUntitled,
    },
    setError,
    sources.updateSource,
    () => {
      notes.touchDocs()
      void workbench.reloadNotes()
    },
  )
  useEffect(() => {
    if (
      !isAdmin ||
      route.viewMode !== 'workbench' ||
      (route.workbenchPane !== 'noteCategories' &&
        route.workbenchPane !== 'sourceCategories')
    ) {
      return
    }
    void categories.reload()
    void workbench.reloadNotes()
  }, [
    categories.reload,
    isAdmin,
    route.viewMode,
    route.workbenchPane,
    workbench.reloadNotes,
  ])
  const notesIo = useNoteTransfer(workbench.docs, () => {
    notes.touchDocs()
    void workbench.reloadNotes()
    sources.reloadBoard()
  })
  useBrewSeo(
    item.selectedItem,
    item.selectedItemSource,
    item.selectedItemOwnState,
    moduleOpenToAll,
    t.nav.brewReading || t.nav.brew,
    t.widgets.brewDesc,
  )

  useEffect(() => {
    if (!item.opening) return
    showToast({
      message: t.common.loading,
      type: 'info',
      replaceKey: 'brew-page',
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
    else navigate('/brew', { replace: true })
  }, [
    itemIdParam,
    item.selectedItem?.id,
    item.closeArticle,
    location.state,
    navigate,
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

  const listItems = filterLaneItems(route.viewMode, list.items, EMPTY_ITEMS)

  const topicFeedMode = useMemo(() => {
    if (!route.selectedTopic) return undefined
    return {
      topicKey: route.selectedTopic.key,
      topicLabel: topicDisplayName(route.selectedTopic, t.brew),
      total: list.total,
      onBack: handleBackFromTopic,
    }
  }, [route.selectedTopic, list.total, handleBackFromTopic, t.brew])

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
    (next: BrewItem | null) => {
      if (next) void actions.select(next)
      else handleCloseReader()
    },
    [actions.select, handleCloseReader],
  )

  const handleReaderStar = useCallback(() => {
    if (item.selectedItem) actions.toggleStar(item.selectedItem)
  }, [item.selectedItem, actions.toggleStar])

  useBrewKeyboard({
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
    onShowHelp: showBrewSearchGuide,
    searchInputRef: brewSearchInputRef,
  })

  useBrewSurface(sources.booting, true)

  const [peekFace, setPeekFace] = useState<BrewPeekFace | null>(null)
  const peekEndTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(peekEndTimer.current), [])
  useEffect(() => {
    window.clearTimeout(peekEndTimer.current)
    setPeekFace(null)
  }, [route.board, route.viewMode])
  useEffect(() => {
    if (item.selectedItem || notes.noteEditor !== null) {
      window.clearTimeout(peekEndTimer.current)
      setPeekFace(null)
    }
  }, [item.selectedItem, notes.noteEditor])
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
      prefetchArticleDetails([item.id])
      const next = toBrewPeekFace(item, storySourceFace(item))
      if (next) setPeekFace(next)
    },
    [],
  )
  const handlePeekEnd = useCallback(() => {
    window.clearTimeout(peekEndTimer.current)
    peekEndTimer.current = window.setTimeout(() => {
      cancelArticlePrefetch()
      clearBrewStoryPeeks()
      setPeekFace(null)
    }, BREW_PEEK_HANDOFF_MS)
  }, [])

  if (sources.booting) {
    return <BrewPage lock={false} loading />
  }

  return (
    <BrewPage lock>
      <BrewPeekAir face={peekFace} />
      <BrewViewLane
        wave={
          route.viewMode === 'topic-feed'
            ? `topic-feed:${route.selectedTopic?.key ?? ''}`
            : route.viewMode === 'workbench'
              ? 'workbench'
              : route.viewMode
        }
        suspended={!!item.selectedItem || notes.noteEditor !== null}
      >
        {route.viewMode === 'workbench' && isAdmin ? (
          <BrewWorkbench
            pane={route.workbenchPane}
            onPane={route.setWorkbenchPane}
            docs={workbench.docs}
            media={workbench.media}
            notesLoading={workbench.notesLoading}
            mediaLoading={workbench.mediaLoading}
            busy={workbench.busy}
            sourceCount={sources.sources.length}
            sources={sources.sources}
            packBusy={pack.loading}
            packProgress={
              pack.progress
                ? `${pack.progress.step}${
                    pack.progress.total > 0
                      ? ` ${pack.progress.current}/${pack.progress.total}`
                      : ''
                  }`
                : null
            }
            onWrite={notes.write}
            onOpenNote={(open) => {
              if (open.kind === 'item') notes.edit(open.id)
              else notes.editDoc(open.id)
            }}
            onDeleteNotes={(docs) => {
              void workbench.removeNotes(docs).then(() => sources.reloadBoard())
            }}
            onUnschedule={workbench.unschedule}
            onUpload={workbench.upload}
            onDeleteMedia={workbench.removeMedia}
            onExportPack={() => void pack.exportPack()}
            onImportPack={(file) => void pack.importFromFile(file)}
            notesBusy={notesIo.loading}
            notesKind={notesIo.activeKind}
            notesProgress={
              notesIo.progress
                ? `${notesIo.progress.step}${
                    notesIo.progress.total > 0
                      ? ` ${notesIo.progress.current}/${notesIo.progress.total}`
                      : ''
                  }`
                : null
            }
            onExportNotes={(kind) => void notesIo.exportKind(kind)}
            onImportNotes={(kind, file) => void notesIo.importKind(kind, file)}
            canRefreshSources={refreshableSourceCount(sources.sources) > 0}
            onRefreshSources={() =>
              Promise.all(
                sources.sources
                  .filter((source) => !isSiteSource(source))
                  .map((source) =>
                    Promise.resolve(sources.refreshSource(source.id)),
                  ),
              )
            }
            noteCategories={categories.noteRows.map((row) => row.name)}
            onAssignNotes={(docs, name) => {
              void categories.assign(
                'notes',
                docs.map((doc) => doc.id),
                name,
              )
            }}
            admin={
              route.workbenchPane === 'noteCategories' ||
              route.workbenchPane === 'sourceCategories' ? (
                <BrewCategoryAdmin
                  page={
                    route.workbenchPane === 'noteCategories'
                      ? 'notes'
                      : 'sources'
                  }
                  rows={
                    route.workbenchPane === 'noteCategories'
                      ? categories.noteRows
                      : categories.sourceRows
                  }
                  loading={categories.loading}
                  busy={categories.busy}
                  onCreate={categories.create}
                  onRename={(from, to) =>
                    categories.rename(
                      from,
                      to,
                      route.workbenchPane === 'noteCategories'
                        ? 'notes'
                        : 'sources',
                    )
                  }
                  onDelete={(name) =>
                    categories.remove(
                      name,
                      route.workbenchPane === 'noteCategories'
                        ? 'notes'
                        : 'sources',
                    )
                  }
                />
              ) : route.workbenchPane === 'sources' ||
                route.workbenchPane === 'add' ||
                route.workbenchPane === 'rsshub' ||
                route.workbenchPane === 'feedsIo' ? (
                <BrewWorkbenchAdmin
                  pane={route.workbenchPane}
                  extraCategories={categories.names}
                  onAssignSources={(ids, name) => {
                    void categories.assign('sources', ids, name)
                  }}
                  sources={sources.sources}
                  onAddSource={sources.addSource}
                  onDiscover={sources.discoverSource}
                  onImportOpml={sources.importOpml}
                  onExportOpml={pack.exportOpml}
                  onUpdateSource={sources.updateSource}
                  onRemoveSources={sources.removeSources}
                  onRefreshSource={sources.refreshSource}
                  onGenerateStyleTags={sources.generateStyleTags}
                />
              ) : null
            }
          />
        ) : null}
        {route.viewMode === 'sources' && (
          <BrewSourceGrid
            sources={sources.sources}
            board={route.board}
            focusSourceId={route.railFocusId}
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
          />
        )}

        {showsFilterLane(
          route.viewMode,
          !!route.selectedTopic,
          isAuthenticated,
        ) ? (
          <BrewFilterLane
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
          />
        ) : null}
      </BrewViewLane>

      <AnimatePresence mode="wait">
        {item.selectedItem && (
          <BrewReader
            key="brew-reader"
            item={item.selectedItem}
            onClose={handleCloseReader}
            onToggleStar={handleReaderStar}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            sourceType={item.selectedItemSource?.source_type}
            onEditNote={
              isAdmin && item.selectedItemSource?.source_type === 'note'
                ? () => notes.edit(item.selectedItem!.id)
                : undefined
            }
            shareUrl={
              item.selectedItemIsOwn
                ? `${typeof window !== 'undefined' ? window.location.origin : ''}${brewOwnItemPath(item.selectedItem.id)}`
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
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {notes.noteEditor !== null && (
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
        )}
      </AnimatePresence>
    </BrewPage>
  )
}
