import type { ReactNode } from 'react'
import type { BrewItemPreview, BrewNoteDoc, BrewSource } from '../../../types/brew'
import type { BrewBoard } from '../logic/board'

import type { FeedStory } from '../logic/feedStories'

import type { HomeBoardNote } from '../logic/homeBoard'
import { useI18n } from '../../../contexts/I18nContext'
import {
  notesBoardIsEmpty,
  visibleCloudNoteDocs,
} from '../notes/noteBoard'
import { BrewVacant } from '../ui/Empty'
import BrewFeeds from './BrewFeeds'
import BrewFriends from './BrewFriends'
import BrewNotes from './BrewNotes'
import '../ui/brew.css'

interface BrewBoardViewProps {
  board: BrewBoard
  sources: BrewSource[]
  focusSourceId?: number | null
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onSourceClick: (source: BrewSource) => void
  onOpenItem?: (item: BrewItemPreview, source: BrewSource) => void
  onPeekItem?: (item: BrewItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewItemPreview) => void
  onEditSource?: (source: BrewSource) => void
  onOpenDoc?: (id: number) => void
  onSitesOpenChange?: (open: boolean) => void
  toolbar?: ReactNode
  notes?: HomeBoardNote[]
  docs?: BrewNoteDoc[]
  vacant?: ReactNode
  stories?: FeedStory[]
  onExpandStories?: (direction: 1 | -1) => void
  onJumpSource?: (sourceId: number) => void
  onHoldStories?: () => void
  onReleaseStories?: () => void
  railEpoch?: number | string
  onReadySource?: (id: number | null) => void
  sourceTags?: ReactNode
}

export default function BrewBoardView({
  board,
  sources,
  focusSourceId,
  isEditMode = false,
  selectedIds,
  onToggleSelect,
  onSourceClick,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onEditSource,
  onOpenDoc,
  onSitesOpenChange,
  toolbar,
  notes = [],
  docs = [],
  vacant,
  stories,
  onExpandStories,
  onJumpSource,
  onHoldStories,
  onReleaseStories,
  railEpoch = 0,
  onReadySource,
  sourceTags,
}: BrewBoardViewProps) {
  const { t } = useI18n()

  const cloudDocs = board === 'notes' ? visibleCloudNoteDocs(docs) : []
  const empty =
    board === 'notes'
      ? notesBoardIsEmpty(sources.length, notes.length, docs)
      : sources.length === 0

  if (empty && board !== 'feeds') {
    return (
      <BrewVacant
        layout={board === 'sites' ? 'friends' : 'articles'}
        title={
          board === 'notes'
            ? t.brew.emptyNoNotes
            : board === 'sites'
              ? t.brew.emptyNoSites
              : t.brew.emptyNoSources
        }
        articleTitle={
          board === 'sites' ? t.brew.friendArticles : undefined
        }
      />
    )
  }

  if (board === 'feeds') {
    return (
      <BrewFeeds
        sources={sources}
        focusSourceId={focusSourceId}
        isEditMode={isEditMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onSourceClick={onSourceClick}
        onOpenItem={onOpenItem}
        onPeekItem={onPeekItem}
        onPeekEnd={onPeekEnd}
        onToggleStar={onToggleStar}
        onEditSource={onEditSource}
        onSitesOpenChange={onSitesOpenChange}
        toolbar={toolbar}
        vacant={vacant}
        stories={stories}
        onExpandStories={onExpandStories}
        onJumpSource={onJumpSource}
        onHoldStories={onHoldStories}
        onReleaseStories={onReleaseStories}
        railEpoch={railEpoch}
        onReadySource={onReadySource}
        sourceTags={sourceTags}
      />
    )
  }

  if (board === 'sites') {
    return (
      <BrewFriends
        sources={sources}
        stories={stories ?? []}
        isEditMode={isEditMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onOpenItem={onOpenItem}
        onPeekItem={onPeekItem}
        onPeekEnd={onPeekEnd}
        onToggleStar={onToggleStar}
        onEditSource={onEditSource}
      />
    )
  }

  return (
    <BrewNotes
      sources={sources}
      notes={notes}
      docs={cloudDocs}
      isEditMode={isEditMode}
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      onSourceClick={onSourceClick}
      onOpenItem={onOpenItem}
      onPeekItem={onPeekItem}
      onPeekEnd={onPeekEnd}
      onToggleStar={onToggleStar}
      onOpenDoc={onOpenDoc}
    />
  )
}
