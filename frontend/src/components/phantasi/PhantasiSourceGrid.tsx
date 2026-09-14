import type {
  AddSourceInput,
  PhantasiItemPreview,
  PhantasiNoteDoc,
  PhantasiSource,
  UpdateSourceRequest,
} from '../../types/phantasi'
import type { PhantasiBoard, SourceSortMode } from './logic/board'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { useI18n } from '../../contexts/I18nContext'
import * as phantasiApi from '../../services/phantasiApi'
import { refreshableSourceCount } from './logic/board'
import { storiesFromSources } from './logic/feedStories'
import { roleFromAuth } from './logic/score'
import { readSourceSortMode, writeSourceSortMode } from './logic/sourceSort'
import PhantasiControls from './manager/PhantasiControls'
import { PhantasiSourceTitleTags } from './manager/PhantasiSourceTitleTags'
import PhantasiBoardView from './skin/PhantasiBoard'
import { PhantasiViewLane } from './skin/PhantasiChip'
import { PhantasiPageStage } from './ui/PhantasiPageStage'
import { PhantasiRailTitle } from './ui/PhantasiRailTitle'
import { PhantasiVacant } from './ui/Empty'
import { useArticleFlags } from './useArticleFlags'
import { useBoardEdit } from './useBoardEdit'
import {
  useBoardCatalog,
  useBoardNotes,
  useFeedStories,
} from './useBoardPage'

interface PhantasiSourceGridProps {
  sources: PhantasiSource[]
  board: PhantasiBoard
  focusSourceId?: number | null
  onSourceClick: (source: PhantasiSource) => void
  onRefreshSource: (sourceId: number) => void
  onSourcesChange?: () => void
  onAddSource?: (input: AddSourceInput) => Promise<void>
  onUpdateSource?: (id: number, data: UpdateSourceRequest) => Promise<void>
  onDiscoverSource?: (url: string) => Promise<{
    url: string
    title: string
    feed_type: string
    autocompleted: boolean
  } | null>
  onGenerateStyleTags?: (
    sourceId: number,
    signal?: AbortSignal,
  ) => Promise<{ success: boolean; tags?: string[] }>
  onImportOpml?: (
    content: string,
    signal?: AbortSignal,
  ) => Promise<{ imported: number; skipped: number }>
  onRemoveSources?: (ids: number[]) => Promise<void>
  onOpenItem?: (item: PhantasiItemPreview, source: PhantasiSource) => void
  onPeekItem?: (item: PhantasiItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: PhantasiItemPreview) => void
  onWriteNote?: () => void
  onOpenDoc?: (id: number) => void
  onMarkAllRead?: () => void
  docsEpoch?: number
  isAuthenticated?: boolean
  isAdmin?: boolean
}

export default function PhantasiSourceGrid({
  sources,
  board,
  focusSourceId,
  onSourceClick,
  onRefreshSource,
  onUpdateSource,
  onDiscoverSource,
  onGenerateStyleTags,
  onRemoveSources,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onWriteNote,
  onOpenDoc,
  onMarkAllRead,
  docsEpoch = 0,
  isAuthenticated = false,
  isAdmin = false,
}: PhantasiSourceGridProps) {
  const { t } = useI18n()
  const titleId = useId()
  const viewerRole = roleFromAuth(isAuthenticated, isAdmin)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SourceSortMode>(readSourceSortMode)
  const [scoreNow, setScoreNow] = useState(() => Date.now())
  const { categories, filtered, sorted } = useBoardCatalog(
    sources,
    board,
    searchQuery,
    sortMode,
    viewerRole,
    scoreNow,
  )
  const notes = useBoardNotes(board, sources)
  const [docs, setDocs] = useState<PhantasiNoteDoc[]>([])
  useEffect(() => {
    if (board !== 'notes' || !isAdmin) {
      setDocs([])
      return
    }
    const controller = new AbortController()
    void phantasiApi
      .listNoteDocs(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setDocs(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) setDocs([])
      })
    return () => controller.abort()
  }, [board, isAdmin, notes, docsEpoch])
  const { stories, onStar, expand, jump, holdStories, releaseStories, railEpoch } =
    useFeedStories(board, sorted, onToggleStar)
  const flags = useArticleFlags()
  const friendSeed = useRef(Math.random())
  const friendStories = (
    board === 'sites' ? storiesFromSources(sorted, friendSeed.current) : []
  ).map((story) => flags.project(story))
  const edit = useBoardEdit(
    filtered,
    onRemoveSources,
    onRefreshSource,
    t.errors.phantasiSourceDeleteFailed,
    t.errors.phantasiRefreshFailed,
  )

  const handleSortModeChange = useCallback((mode: SourceSortMode) => {
    writeSourceSortMode(mode)
    setSortMode(mode)
    setScoreNow(Date.now())
  }, [])
  const bar = useMemo(
    () =>
      board === 'feeds' ? (
        <PhantasiControls
          sources={sources}
          filteredSources={sorted}
          categories={categories}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isAdmin={isAdmin}
        />
      ) : null,
    [board, sources, sorted, categories, searchQuery, isAdmin],
  )

  const sourceTags = useMemo(
    () => (
      <PhantasiSourceTitleTags
        kind={board === 'feeds' ? 'feeds' : 'salon'}
        sortMode={sortMode}
        onSortModeChange={handleSortModeChange}
        isAdmin={isAdmin}
        isAuthenticated={isAuthenticated}
        canEdit
        editing={edit.isEditMode}
        selectedIds={edit.selectedIds}
        sources={sorted}
        categories={categories}
        refreshableCount={refreshableSourceCount(sorted)}
        isDeleting={edit.isDeleting}
        isRefreshing={edit.isRefreshing}
        onEnterEdit={undefined}
        onExitEdit={edit.handleExitEditMode}
        onSelectAll={edit.handleSelectAll}
        onBatchDelete={edit.handleBatchDelete}
        onBatchRefresh={edit.handleBatchRefresh}
        onMarkAllRead={onMarkAllRead}
        onWriteNote={board === 'notes' ? onWriteNote : undefined}
        onUpdateSource={onUpdateSource}
        onDiscover={onDiscoverSource}
        onGenerateStyleTags={onGenerateStyleTags}
      />
    ),
    [
      board,
      sortMode,
      handleSortModeChange,
      isAdmin,
      isAuthenticated,
      edit.isEditMode,
      edit.selectedIds,
      sorted,
      categories,
      edit.isDeleting,
      edit.isRefreshing,
      edit.handleEnterEditMode,
      edit.handleExitEditMode,
      edit.handleSelectAll,
      edit.handleBatchDelete,
      edit.handleBatchRefresh,
      onMarkAllRead,
      onWriteNote,
      onUpdateSource,
      onDiscoverSource,
      onGenerateStyleTags,
    ],
  )

  const searchMiss = filtered.length === 0 && !!searchQuery.trim()
  const miss = useMemo(
    () => (
      <PhantasiVacant
        title={t.phantasi.noMatchingSources}
        hint={t.phantasi.tryOtherKeywords}
      />
    ),
    [t.phantasi.noMatchingSources, t.phantasi.tryOtherKeywords],
  )

  const boardView = (
    <PhantasiBoardView
      board={board}
      sources={sorted}
      focusSourceId={board === 'feeds' ? focusSourceId : undefined}
      isEditMode={edit.boardEdit}
      selectedIds={edit.selectedIds}
      onToggleSelect={edit.handleToggleSelect}
      onSourceClick={onSourceClick}
      onOpenItem={onOpenItem}
      onPeekItem={onPeekItem}
      onPeekEnd={onPeekEnd}
      onToggleStar={board === 'feeds' ? onStar : onToggleStar}
      onEditSource={undefined}
      toolbar={bar}
      vacant={board === 'feeds' && searchMiss ? miss : null}
      stories={
        board === 'feeds' ? stories : board === 'sites' ? friendStories : undefined
      }
      onExpandStories={board === 'feeds' ? expand : undefined}
      onJumpSource={board === 'feeds' ? jump : undefined}
      onHoldStories={board === 'feeds' ? holdStories : undefined}
      onReleaseStories={board === 'feeds' ? releaseStories : undefined}
      railEpoch={board === 'feeds' ? railEpoch : 0}
      sourceTags={board === 'feeds' ? sourceTags : undefined}
      notes={notes}
      docs={docs}
      onOpenDoc={onOpenDoc}
    />
  )

  return (
    <PhantasiViewLane
      wave={board}
      className="relative min-h-0 flex-1 overflow-visible"
    >
      {board === 'feeds' ? (
        <div className="flex min-h-0 flex-1 flex-col">{boardView}</div>
      ) : (
        <PhantasiPageStage
          title={
            <PhantasiRailTitle
              id={titleId}
              action={sourceTags}
              pinned={edit.isEditMode}
            >
              {board === 'notes' ? t.phantasi.boardNotes : t.phantasi.boardSites}
            </PhantasiRailTitle>
          }
        >
          {boardView}
        </PhantasiPageStage>
      )}
    </PhantasiViewLane>
  )
}
