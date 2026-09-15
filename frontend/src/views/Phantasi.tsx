import type { BoardScroll } from '../components/phantasi/logic/boardScroll'

import type { PhantasiItem } from '../types/phantasi'
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
} from 'react-router-dom'
import {
  cancelArticlePrefetch,
  prefetchArticleDetails,
} from '../components/phantasi/articlePrefetch'
import { phantasiBoardNavItems } from '../components/phantasi/boardNav'
import PhantasiFilterLane from '../components/phantasi/PhantasiFilterLane'
import PhantasiReader from '../components/phantasi/PhantasiReader'
import PhantasiSourceGrid from '../components/phantasi/PhantasiSourceGrid'
import { phantasiOwnItemPath } from '../components/phantasi/constants'
import { storySourceFace } from '../components/phantasi/notes/noteSiteSource'
import {
  PHANTASI_PEEK_HANDOFF_MS,
  PhantasiPeekAir,
  toPhantasiPeekFace,
  type PhantasiPeekFace,
} from '../components/phantasi/ui/PhantasiPeekAir'
import { clearPhantasiStoryPeeks } from '../components/phantasi/ui/StoryCard'
import {
  filterLaneItems,
  isSiteSource,
  refreshableSourceCount,
  showsFilterLane,
} from '../components/phantasi/logic/board'
import {
  captureBoardScroll,
  restoreBoardScroll,
} from '../components/phantasi/logic/boardScroll'
import { shouldPopOpenedItem } from '../components/phantasi/logic/phantasiItemRoute'
import { topicDisplayName } from '../components/phantasi/logic/topics'
import { PhantasiCategoryAdmin } from '../components/phantasi/manager/PhantasiCategoryAdmin'
import { PhantasiWorkbenchAdmin } from '../components/phantasi/manager/PhantasiWorkbenchAdmin'
import { usePipack } from '../components/phantasi/manager/usePipack'
import { useNoteTransfer } from '../components/phantasi/manager/useNoteTransfer'
import NoteEditor from '../components/phantasi/notes/NoteEditor'
import { PhantasiViewLane } from '../components/phantasi/skin/PhantasiChip'
import { AnimatePresence, PhantasiPage } from '../components/phantasi/skin/PhantasiPage'
import PhantasiWorkbench from '../components/phantasi/skin/PhantasiWorkbench'
import {
  phantasiSearchInputRef,
  showPhantasiSearchGuide,
} from '../components/phantasi/ui/PhantasiSearch'
import { usePhantasiAgentOpen } from '../components/phantasi/usePhantasiAgentOpen'
import { usePhantasiBoardRoute } from '../components/phantasi/usePhantasiBoardRoute'
import { usePhantasiCategories } from '../components/phantasi/usePhantasiCategories'
import { usePhantasiItemActions } from '../components/phantasi/usePhantasiItemActions'
import { usePhantasiItemRoute } from '../components/phantasi/usePhantasiItemRoute'
import { usePhantasiItems } from '../components/phantasi/usePhantasiItems'
import { usePhantasiNavExpand } from '../components/phantasi/usePhantasiNavExpand'
import { usePhantasiNotes } from '../components/phantasi/usePhantasiNotes'
import { usePhantasiSeo } from '../components/phantasi/usePhantasiSeo'
import { usePhantasiSources } from '../components/phantasi/usePhantasiSources'
import { usePhantasiStarred } from '../components/phantasi/usePhantasiStarred'
import { usePhantasiSurface } from '../components/phantasi/usePhantasiSurface'
import { usePhantasiWorkbench } from '../components/phantasi/usePhantasiWorkbench'
import * as phantasiApi from '../services/phantasiApi'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import { useSecondaryNav } from '../contexts/NavigationContext'
import { useReadingListOptional } from '../contexts/ReadingListContext'
import { usePhantasiScheduler } from '../hooks/animation'
import { usePhantasiKeyboard } from '../hooks/usePhantasiKeyboard'
import { phantasiSubject } from '../utils/phantasiSubject'
import {
  canAccessModuleVisibility,
  useModuleVisibilityPreferences,
} from '../utils/moduleVisibility'
import { showToast } from '../utils/toastManager'

const EMPTY_ITEMS: PhantasiItem[] = []

export default function Phantasi() {
  const subject = useSyncExternalStore(
    phantasiSubject.subscribe,
    phantasiSubject.getSnapshot,
    phantasiSubject.getSnapshot,
  )
  const { hasChecked } = useAuth()
  if (!hasChecked || !subject.active) return <PhantasiPage lock={false} loading />
  return <PhantasiSubjectPage key={subject.generation} />
}

function PhantasiSubjectPage() {
  usePhantasiScheduler()
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

  const navItems = useMemo(
    () =>
      phantasiBoardNavItems(t.phantasi, {
        includeStarred: isAuthenticated,
        includeWorkbench: isAdmin,
      }),
    [t.phantasi, isAuthenticated, isAdmin],
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
  const pack = usePipack(sources.sources, sources.reloadBoard)
  const workbench = usePhantasiWorkbench(
    isAdmin && route.viewMode === 'workbench',
    notes.docsEpoch,
    {
      loadFailed: t.phantasi.workbenchLoadFailed,
      noteDeleteFailed: t.errors.operationFailed,
      unscheduleFailed: t.phantasi.workbenchUnscheduleFailed,
      mediaLoadFailed: t.errors.mediaLoadFailed,
      mediaUploadFailed: t.errors.mediaUploadFailed,
      mediaDeleteFailed: t.errors.mediaDeleteFailed,
      commentDeleteFailed: t.phantasi.workbenchCommentDeleteFailed,
    },
    setError,
  )
  const categories = usePhantasiCategories(
    isAdmin && route.viewMode === 'workbench',
    workbench.docs,
    sources.sources,
    {
      loadFailed: t.phantasi.workbenchCategoryLoadFailed,
      createFailed: t.phantasi.workbenchCategoryCreateFailed,
      renameFailed: t.phantasi.workbenchCategoryRenameFailed,
      deleteFailed: t.phantasi.workbenchCategoryDeleteFailed,
      assignFailed: t.phantasi.workbenchAssignCategoryFailed,
      categoryFull: t.phantasi.workbenchCategoryFull,
      untitled: t.phantasi.workbenchNoteUntitled,
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

  const listItems = filterLaneItems(route.viewMode, list.items, EMPTY_ITEMS)

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

  const [peekFace, setPeekFace] = useState<PhantasiPeekFace | null>(null)
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
      const next = toPhantasiPeekFace(item, storySourceFace(item))
      if (next) setPeekFace(next)
    },
    [],
  )
  const handlePeekEnd = useCallback(() => {
    window.clearTimeout(peekEndTimer.current)
    peekEndTimer.current = window.setTimeout(() => {
      cancelArticlePrefetch()
      clearPhantasiStoryPeeks()
      setPeekFace(null)
    }, PHANTASI_PEEK_HANDOFF_MS)
  }, [])

  if (sources.booting) {
    return <PhantasiPage lock={false} loading />
  }

  return (
    <PhantasiPage lock>
      <PhantasiPeekAir face={peekFace} />
      <PhantasiViewLane
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
          <PhantasiWorkbench
            pane={route.workbenchPane}
            onPane={route.setWorkbenchPane}
            docs={workbench.docs}
            media={workbench.media}
            comments={workbench.comments}
            notesLoading={workbench.notesLoading}
            mediaLoading={workbench.mediaLoading}
            commentsLoading={workbench.commentsLoading}
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
            onDeleteComments={(ids) => {
              void workbench.removeComments(ids)
            }}
            onOpenCommentItem={(id) => {
              void item.openArticle((signal) =>
                phantasiApi.getItem(id, undefined, { signal }),
              )
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
                <PhantasiCategoryAdmin
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
                <PhantasiWorkbenchAdmin
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
          />
        )}

        {showsFilterLane(
          route.viewMode,
          !!route.selectedTopic,
          isAuthenticated,
        ) ? (
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
          />
        ) : null}
      </PhantasiViewLane>

      <AnimatePresence mode="wait">
        {item.selectedItem && (
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
                ? `${typeof window !== 'undefined' ? window.location.origin : ''}${phantasiOwnItemPath(item.selectedItem.id)}`
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
    </PhantasiPage>
  )
}
