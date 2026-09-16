/** 笔记：云端稿、已发布、剩下的自有源都走文章卡。 */

import type { CSSProperties } from 'react'
import type { PhantasiItemPreview, PhantasiNoteDoc, PhantasiSource } from '../../../types/phantasi'
import type { HomeBoardNote } from '../logic/homeBoard'
import { useMemo, useRef } from 'react'
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
import { StoryCard, clearPhantasiStoryPeeks, usePhantasiPeekLane } from '../ui/StoryCard'
import { PhantasiStory } from './PhantasiStory'
import { usePhantasiTimes } from './time'
import { usePhantasiRailPan } from './usePhantasiRailPan'

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
  onPeekItem?: (item: PhantasiItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: PhantasiItemPreview) => void
  onOpenDoc?: (id: number) => void
}) {
  const { t, locale } = useI18n()
  const times = usePhantasiTimes()
  const labels = t.phantasi
  const leftover = leftoverNoteSources(sources, notes)
  const byId = new Map(sources.map((source) => [source.id, source]))
  const shownDocs = docs.filter((doc) => matchesNoteCategory(doc.topic, category))
  const shownNotes = notes.filter((note) => matchesNoteCategory(note.topic, category))
  const shownLeftover = leftover.filter((source) => {
    if (category == null) return true
    const story = sourceLatestStory(source)
    if (story) return matchesNoteCategory(story.topic, category)
    return category === NOTE_CATEGORY_NONE
  })
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
  usePhantasiRailPan(
    notesViewRef,
    notesTrackRef,
    cardCount > 0,
    notesKey,
    '.phantasi-story',
    undefined,
    undefined,
    true,
    undefined,
    () => {
      clearPhantasiStoryPeeks(notesTrackRef.current)
      onPeekEnd?.()
    },
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

  const openArticle = (item: PhantasiItemPreview, sourceId: number) => {
    if (isEditMode) {
      onToggleSelect?.(sourceId)
      return
    }
    const source = byId.get(sourceId)
    if (source) onOpenItem(item, source, wallNeighbors)
  }

  let cardAt = 0
  const takeSeat = () => {
    const index = cardAt
    cardAt += 1
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
    <div className="phantasi-notes-board">
      <div
        className="phantasi-skin phantasi-notes"
        ref={notesViewRef}
        data-phantasi-peek-lane
        {...peekLane}
      >
      <div
        className="phantasi-notes-track"
        ref={notesTrackRef}
        data-phantasi-rail-track="items"
        style={{ '--phantasi-story-cols': storyCols } as CSSProperties}
      >
      {shownDocs.map((doc) => {
        const faceTopic = noteStoryTopic(doc.topic, labels)
        const seat = takeSeat()
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
      })}
      {shownNotes.map((note) => {
        const source = byId.get(note.source_id)
        const item = toNoteStory(note, source)
        const seat = takeSeat()
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
            onOpen={() => openArticle(item, note.source_id)}
            onToggleStar={
              isEditMode || !onToggleStar
                ? undefined
                : (story) => onToggleStar(story)
            }
          />
        )
      })}
      {shownLeftover.map((source) => {
        const story = sourceLatestStory(source)
        const seat = takeSeat()
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
              onOpen={() => openArticle(story, source.id)}
              onToggleStar={
                isEditMode || !onToggleStar
                  ? undefined
                  : (item) => onToggleStar(item)
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
    </div>
  )
}
