/** 笔记：云端稿、已发布、剩下的自有源都走文章卡。 */

import type { CSSProperties } from 'react'
import type {
  PhantasiItemPreview,
  PhantasiNoteDoc,
  PhantasiSource,
} from '../../../types/phantasi'
import type { HomeBoardNote } from '../logic/homeBoard'
import type { PeekStoryPreview } from '../ui/peekLane'
import { useCallback, useMemo, useRef } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { getIconUrl, getImageUrl } from '../constants'
import { isSiteSource, visitFriendHref } from '../logic/board'
import { toNoteStory } from '../logic/homeBoard'
import { notesWallNeighbors } from '../logic/readingQueue'
import {
  leftoverNoteSources,
  noteDocKicker,
  sourceLatestStory,
} from '../notes/noteBoard'
import {
  matchesNoteCategory,
  NOTE_CATEGORY_NONE,
  noteStoryTopic,
} from '../notes/noteCategory'
import { storySourceFace } from '../notes/noteSiteSource'
import {
  clearPhantasiStoryPeeks,
  StoryCard,
  usePhantasiPeekLane,
} from '../ui/StoryCard'
import { PhantasiStory } from './PhantasiStory'
import { usePhantasiTimes } from './time'
import { useStoryWindow } from './useStoryWindow'

function openLink(source: PhantasiSource) {
  const href = visitFriendHref(source)
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

export default function PhantasiNotes({
  sources,
  notes,
  docs,
  category = null,
  loading = false,
  failed = false,
  onRetry,
  isEditMode = false,
  selectedIds,
  onToggleSelect,
  onSourceClick,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onOpenDoc,
}: {
  sources: PhantasiSource[]
  notes: HomeBoardNote[]
  docs: PhantasiNoteDoc[]
  loading?: boolean
  failed?: boolean
  onRetry?: () => void
  category?: string | null
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onSourceClick: (source: PhantasiSource) => void
  onOpenItem: (
    item: PhantasiItemPreview,
    source: PhantasiSource,
    neighbors?: Array<{ id: number; title: string }>,
  ) => void
  onPeekItem?: (item: PeekStoryPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: PhantasiItemPreview) => void
  onOpenDoc?: (id: number) => void
}) {
  const { t, locale } = useI18n()
  const times = usePhantasiTimes()
  const labels = t.phantasi
  const leftover = useMemo(
    () => leftoverNoteSources(sources, notes),
    [sources, notes],
  )
  const byId = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  )
  const shownDocs = useMemo(
    () => docs.filter((doc) => matchesNoteCategory(doc.topic, category)),
    [docs, category],
  )
  const shownNotes = useMemo(
    () => notes.filter((note) => matchesNoteCategory(note.topic, category)),
    [notes, category],
  )
  const shownLeftover = useMemo(
    () =>
      leftover.filter((source) => {
        if (category == null) return true
        const story = sourceLatestStory(source)
        if (story) return matchesNoteCategory(story.topic, category)
        return category === NOTE_CATEGORY_NONE
      }),
    [leftover, category],
  )
  const cardCount = shownDocs.length + shownNotes.length + shownLeftover.length
  const storyCols = Math.max(1, Math.ceil(cardCount / 2))
  const notesViewRef = useRef<HTMLDivElement>(null)
  const notesTrackRef = useRef<HTMLDivElement>(null)
  const notesKey = useMemo(
    () =>
      [
        ...shownDocs.map((doc) => `doc:${doc.id}`),
        ...shownNotes.map((note) => `note:${note.id}`),
        ...shownLeftover.map((source) => `source:${source.id}`),
      ].join(','),
    [shownDocs, shownLeftover, shownNotes],
  )
  const wallNeighbors = useMemo(
    () =>
      notesWallNeighbors(
        shownNotes,
        shownLeftover.map((source) => sourceLatestStory(source)),
      ),
    [shownLeftover, shownNotes],
  )
  const peekById = useMemo(() => {
    const map = new Map<number, PhantasiItemPreview>()
    for (const note of shownNotes) {
      map.set(note.id, toNoteStory(note, byId.get(note.source_id)))
    }
    for (const source of shownLeftover) {
      const story = sourceLatestStory(source)
      if (story) map.set(story.id, story)
    }
    return map
  }, [byId, shownLeftover, shownNotes])
  const peekLane = usePhantasiPeekLane({
    onPeek: (preview) => {
      const item = peekById.get(preview.id)
      if (item) onPeekItem?.(item)
    },
    onPeekEnd,
    blocked: () => isEditMode || !onPeekItem,
  })
  const window = useStoryWindow(
    cardCount,
    notesKey,
    notesViewRef,
    notesTrackRef,
    () => {
      clearPhantasiStoryPeeks(notesTrackRef.current)
      onPeekEnd?.()
    },
    JSON.stringify([
      category,
      shownDocs[0]
        ? `doc:${shownDocs[0].id}`
        : shownNotes[0]
          ? `note:${shownNotes[0].id}`
          : `source:${shownLeftover[0]?.id}`,
    ]),
  )

  const activateSource = (source: PhantasiSource) => {
    if (isEditMode) {
      onToggleSelect?.(source.id)
      return
    }
    if (isSiteSource(source)) {
      openLink(source)
      return
    }
    const latest = sourceLatestStory(source)
    if (latest) {
      onOpenItem(latest, source, wallNeighbors)
      return
    }
    onSourceClick(source)
  }

  const openArticle = useCallback(
    (item: PhantasiItemPreview & { source_id?: number }) => {
      const sourceId = item.source_id
      if (sourceId == null) return
      if (isEditMode) {
        onToggleSelect?.(sourceId)
        return
      }
      const source = byId.get(sourceId)
      if (source) onOpenItem(item, source, wallNeighbors)
    },
    [byId, isEditMode, onToggleSelect, onOpenItem, wallNeighbors],
  )

  const takeSeat = (index: number) => {
    const column = Math.floor(index / 2) + 1
    return {
      arrive: index < 8 ? index : undefined,
      railCol: column,
      place: {
        column,
        row: (index % 2 === 0 ? 1 : 2) as 1 | 2,
      },
    }
  }

  return (
    <div data-tour="journal-notes" className="phantasi-notes-board" aria-busy={loading}>
      <div
        className="phantasi-skin phantasi-notes"
        ref={notesViewRef}
        data-phantasi-peek-lane
        {...peekLane}
        onFocusCapture={window.onFocusCapture}
        onBlurCapture={window.onBlurCapture}
      >
        <div
          className="phantasi-notes-track"
          ref={notesTrackRef}
          data-phantasi-rail-track="items"
          style={{ '--phantasi-story-cols': storyCols } as CSSProperties}
        >
          {window.indices.map((index) => {
            if (index < shownDocs.length) {
              const doc = shownDocs[index]!
              const faceTopic = noteStoryTopic(doc.topic, labels)
              const seat = takeSeat(index)
              return (
                <StoryCard
                  key={`doc:${doc.id}`}
                  arrive={seat.arrive}
                  railCol={seat.railCol}
                  place={seat.place}
                  unreadLabel={labels.unread}
                  starLabel={labels.starred}
                  unstarLabel={labels.unstar}
                  onOpen={() => onOpenDoc?.(doc.id)}
                  face={{
                    id: `doc:${doc.id}`,
                    title: doc.title.trim() || labels.noteCloudDraft,
                    summary: (doc.excerpt ?? doc.content_md).slice(0, 80),
                    cover: getImageUrl(doc.image),
                    when: noteDocKicker(
                      doc,
                      {
                        failed: labels.noteScheduleFailed,
                        scheduled: labels.noteStatusScheduled,
                        draft: labels.noteStatusDraft,
                      },
                      locale,
                    ),
                    topic: faceTopic.topic,
                    hue: faceTopic.hue,
                  }}
                />
              )
            }
            const noteIndex = index - shownDocs.length
            if (noteIndex < shownNotes.length) {
              const note = shownNotes[noteIndex]!
              const item = peekById.get(note.id)!
              const seat = takeSeat(index)
              return (
                <PhantasiStory
                  key={`note:${note.id}`}
                  item={item}
                  times={times}
                  locale={locale}
                  labels={labels}
                  arrive={seat.arrive}
                  railCol={seat.railCol}
                  place={seat.place}
                  picking={isEditMode}
                  picked={!!selectedIds?.has(note.source_id)}
                  onOpen={openArticle}
                  onToggleStar={
                    isEditMode || !onToggleStar ? undefined : onToggleStar
                  }
                />
              )
            }
            const source = shownLeftover[noteIndex - shownNotes.length]!
            const story = source.recent_items?.[0]
              ? peekById.get(source.recent_items[0].id)
              : undefined
            const seat = takeSeat(index)
            if (story) {
              return (
                <PhantasiStory
                  key={`source:${source.id}`}
                  item={story}
                  times={times}
                  locale={locale}
                  labels={labels}
                  arrive={seat.arrive}
                  railCol={seat.railCol}
                  place={seat.place}
                  picking={isEditMode}
                  picked={!!selectedIds?.has(source.id)}
                  onOpen={openArticle}
                  onToggleStar={
                    isEditMode || !onToggleStar ? undefined : onToggleStar
                  }
                />
              )
            }
            const sourceFace = storySourceFace({
              source_type: source.source_type,
              source_name: source.name,
              source_icon: source.icon,
            })
            return (
              <StoryCard
                key={`source:${source.id}`}
                arrive={seat.arrive}
                railCol={seat.railCol}
                place={seat.place}
                picking={isEditMode}
                picked={!!selectedIds?.has(source.id)}
                unreadLabel={labels.unread}
                starLabel={labels.starred}
                unstarLabel={labels.unstar}
                onOpen={() => activateSource(source)}
                face={{
                  id: `source:${source.id}`,
                  title: source.name,
                  summary: source.description || '',
                  source: sourceFace.name,
                  sourceIcon: getIconUrl(sourceFace.icon),
                }}
              />
            )
          })}
        </div>
      </div>
      {failed ? (
        <div className="phantasi-stories__more" role="status">
          {labels.loadFailed}{' '}
          <button type="button" onClick={onRetry}>
            {t.common.retry}
          </button>
        </div>
      ) : loading ? (
        <div className="phantasi-stories__more" role="status">
          {labels.loading}
        </div>
      ) : null}
    </div>
  )
}
