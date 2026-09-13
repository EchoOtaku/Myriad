import type {
  AddSourceInput,
  BrewItemPreview,
  BrewSource,
  UpdateSourceRequest,
} from '../../types/brew'
import type { BrewBoard, SourceSortMode } from './logic/board'
import { refreshableSourceCount } from './logic/board'

import { useCallback, useId, useMemo, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { roleFromAuth } from './logic/score'
import BrewControls from './manager/BrewControls'
import { BrewSourceTitleTags } from './manager/BrewSourceTitleTags'
import { useBrewpack } from './manager/useBrewpack'
import BrewBoardView from './skin/BrewBoard'
import { BrewViewLane } from './skin/BrewChip'
import { BrewVacant } from './ui/Empty'
import { BrewPageStage } from './ui/BrewPageStage'
import { BrewRailTitle } from './ui/BrewRailTitle'
import { useBoardEdit } from './useBoardEdit'
import {
  useBoardCatalog,
  useBoardNotes,
  useFeedStories,
} from './useBoardPage'

interface BrewSourceGridProps {
  sources: BrewSource[]
  board: BrewBoard
  focusSourceId?: number | null
  onSourceClick: (source: BrewSource) => void
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
  onOpenItem?: (item: BrewItemPreview, source: BrewSource) => void
  onPeekItem?: (item: BrewItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewItemPreview) => void
  onWriteNote?: () => void
  onMarkAllRead?: () => void
  isAuthenticated?: boolean
  isAdmin?: boolean
  onBoardSurface?: (board: BrewBoard) => void
}

export default function BrewSourceGrid({
  sources,
  board,
  focusSourceId,
  onSourceClick,
  onRefreshSource,
  onSourcesChange,
  onAddSource,
  onUpdateSource,
  onDiscoverSource,
  onGenerateStyleTags,
  onImportOpml,
  onRemoveSources,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onWriteNote,
  onMarkAllRead,
  isAuthenticated = false,
  isAdmin = false,
  onBoardSurface,
}: BrewSourceGridProps) {
  const { t } = useI18n()
  const titleId = useId()
  const viewerRole = roleFromAuth(isAuthenticated, isAdmin)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SourceSortMode>('smart')
  const [scoreNow, setScoreNow] = useState(() => Date.now())
  const [readySourceId, setReadySourceId] = useState<number | null>(null)

  const { categories, filtered, sorted } = useBoardCatalog(
    sources,
    board,
    searchQuery,
    sortMode,
    viewerRole,
    scoreNow,
  )
  const notes = useBoardNotes(board, sources)
  const readySource = useMemo(
    () => sources.find((source) => source.id === readySourceId) ?? null,
    [sources, readySourceId],
  )
  const { stories, onStar } = useFeedStories(board, readySource, onToggleStar)
  const edit = useBoardEdit(
    board,
    filtered,
    onRemoveSources,
    onRefreshSource,
    t.errors.brewSourceDeleteFailed,
    t.errors.brewRefreshFailed,
  )

  const handleSortModeChange = useCallback((mode: SourceSortMode) => {
    setSortMode(mode)
    setScoreNow(Date.now())
  }, [])
  const handleReadySource = useCallback((id: number | null) => {
    setReadySourceId(id)
  }, [])
  const pack = useBrewpack(sources, onSourcesChange)

  const bar =
    board === 'feeds' ? (
      <BrewControls
        sources={sources}
        filteredSources={sorted}
        categories={categories}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onAddSource={onAddSource}
        onDiscover={onDiscoverSource}
        onImportOpml={onImportOpml}
        onSourcesChange={onSourcesChange}
        isAdmin={isAdmin}
        embedded
      />
    ) : null

  const sourceTags = (
    <BrewSourceTitleTags
      kind={board === 'feeds' ? 'feeds' : 'salon'}
      sortMode={sortMode}
      onSortModeChange={handleSortModeChange}
      isAdmin={isAdmin}
      isAuthenticated={isAuthenticated}
      canEdit={board !== 'feeds' || edit.sitesOpen}
      editing={edit.isEditMode}
      selectedIds={edit.selectedIds}
      sources={sorted}
      categories={categories}
      refreshableCount={refreshableSourceCount(sorted)}
      isDeleting={edit.isDeleting}
      isRefreshing={edit.isRefreshing}
      onEnterEdit={edit.handleEnterEditMode}
      onExitEdit={edit.handleExitEditMode}
      onSelectAll={edit.handleSelectAll}
      onBatchDelete={edit.handleBatchDelete}
      onBatchRefresh={edit.handleBatchRefresh}
      onMarkAllRead={onMarkAllRead}
      onWriteNote={board === 'notes' ? onWriteNote : undefined}
      onUpdateSource={onUpdateSource}
      onGenerateStyleTags={onGenerateStyleTags}
      sourceEditTick={edit.sourceEditTick}
      importExportLoading={board === 'feeds' ? pack.loading : false}
      importProgress={board === 'feeds' ? pack.progress : undefined}
      onBrewExport={board === 'feeds' ? pack.exportPack : undefined}
      onBrewImportFile={board === 'feeds' ? pack.importFile : undefined}
      brewExportInputRef={board === 'feeds' ? pack.inputRef : undefined}
    />
  )

  const searchMiss = filtered.length === 0 && !!searchQuery.trim()
  const miss = useMemo(
    () => (
      <BrewVacant
        title={t.brew.noMatchingSources}
        hint={t.brew.tryOtherKeywords}
      />
    ),
    [t.brew.noMatchingSources, t.brew.tryOtherKeywords],
  )

  const boardView = (
    <BrewBoardView
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
      onEditSource={isAdmin ? edit.handleOpenSourceEdit : undefined}
      onWriteNote={onWriteNote}
      onSitesOpenChange={board === 'feeds' ? edit.setSitesOpen : undefined}
      toolbar={bar}
      vacant={board === 'feeds' && searchMiss ? miss : null}
      stories={board === 'feeds' ? stories : undefined}
      onReadySource={board === 'feeds' ? handleReadySource : undefined}
      sourceTags={board === 'feeds' ? sourceTags : undefined}
      notes={notes}
    />
  )

  return (
    <BrewViewLane
      wave={board}
      onDisplayed={(next) => onBoardSurface?.(next as BrewBoard)}
      className="relative min-h-0 flex-1 overflow-visible"
    >
      {board === 'feeds' ? (
        <div className="flex min-h-0 flex-1 flex-col">{boardView}</div>
      ) : (
        <BrewPageStage
          title={
            <BrewRailTitle id={titleId} action={sourceTags}>
              {board === 'notes' ? t.brew.boardNotes : t.brew.boardSites}
            </BrewRailTitle>
          }
        >
          {boardView}
        </BrewPageStage>
      )}
    </BrewViewLane>
  )
}
