/** 手记：云端稿、已发布、剩下的自有源都走文章卡。 */

import type { CSSProperties } from 'react'
import type { BrewItemPreview, BrewNoteDoc, BrewSource } from '../../../types/brew'
import type { HomeBoardNote } from '../logic/homeBoard'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../../contexts/I18nContext'
import { brewOwnItemPath, getIconUrl, getImageUrl } from '../constants'
import { isSiteSource, visitFriendHref } from '../logic/board'
import { toNoteStory } from '../logic/homeBoard'
import {
  leftoverNoteSources,
  noteDocKicker,
  sourceLatestStory,
} from '../notes/noteBoard'
import {
  collectNoteCategories,
  matchesNoteCategory,
  NOTE_CATEGORY_NONE,
  noteStoryTopic,
} from '../notes/noteCategory'
import { storySourceFace } from '../notes/noteSiteSource'
import { StoryCard } from '../ui/StoryCard'
import { BrewStory } from './BrewStory'
import { useBrewTimes } from './time'
import { useBrewRailPan } from './useBrewRailPan'

function openLink(source: BrewSource) {
  const href = visitFriendHref(source)
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

function CategoryChip({
  label,
  current,
  onPick,
}: {
  label: string
  current: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`brew-notes__cat${current ? ' is-on' : ''}`}
      aria-pressed={current}
      onClick={onPick}
    >
      {label}
    </button>
  )
}

export default function BrewNotes({
  sources,
  notes,
  docs,
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
  sources: BrewSource[]
  notes: HomeBoardNote[]
  docs: BrewNoteDoc[]
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onSourceClick: (source: BrewSource) => void
  onOpenItem?: (item: BrewItemPreview, source: BrewSource) => void
  onPeekItem?: (item: BrewItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewItemPreview) => void
  onOpenDoc?: (id: number) => void
}) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const times = useBrewTimes()
  const labels = t.brew
  const leftover = leftoverNoteSources(sources, notes)
  const byId = new Map(sources.map((source) => [source.id, source]))
  const categories = useMemo(
    () => collectNoteCategories([...notes, ...docs]),
    [docs, notes],
  )
  const hasUnfiled = useMemo(
    () =>
      notes.some((note) => matchesNoteCategory(note.topic, NOTE_CATEGORY_NONE))
      || docs.some((doc) => matchesNoteCategory(doc.topic, NOTE_CATEGORY_NONE))
      || leftover.some((source) => {
        const story = sourceLatestStory(source)
        return !story || matchesNoteCategory(story.topic, NOTE_CATEGORY_NONE)
      }),
    [docs, leftover, notes],
  )
  const [filter, setFilter] = useState<string | null>(null)
  useEffect(() => {
    if (filter && filter !== NOTE_CATEGORY_NONE && !categories.includes(filter)) {
      setFilter(null)
    }
  }, [categories, filter])
  const shownDocs = docs.filter((doc) => matchesNoteCategory(doc.topic, filter))
  const shownNotes = notes.filter((note) => matchesNoteCategory(note.topic, filter))
  const shownLeftover = leftover.filter((source) => {
    if (filter == null) return true
    const story = sourceLatestStory(source)
    if (story) return matchesNoteCategory(story.topic, filter)
    return filter === NOTE_CATEGORY_NONE
  })
  const showCats = categories.length > 0
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
  useBrewRailPan(
    notesViewRef,
    notesTrackRef,
    cardCount > 0,
    notesKey,
    '.brew-story',
    undefined,
    undefined,
    true,
  )

  const activateSource = (source: BrewSource) => {
    if (isEditMode) {
      onToggleSelect?.(source.id)
      return
    }
    if (isSiteSource(source)) {
      openLink(source)
      return
    }
    onSourceClick(source)
  }

  const openArticle = (item: BrewItemPreview, sourceId: number) => {
    if (isEditMode) {
      onToggleSelect?.(sourceId)
      return
    }
    const source = byId.get(sourceId)
    if (source && onOpenItem) onOpenItem(item, source)
    else navigate(brewOwnItemPath(item.id))
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
    <div className="brew-notes-board">
      {showCats ? (
        <div className="brew-notes__cats" role="tablist" aria-label={labels.noteTopic}>
          <CategoryChip
            label={labels.noteCategoryAll}
            current={filter == null}
            onPick={() => setFilter(null)}
          />
          {categories.map((name) => (
            <CategoryChip
              key={name}
              label={noteStoryTopic(name, labels).topic ?? name}
              current={filter === name}
              onPick={() => setFilter(name)}
            />
          ))}
          {hasUnfiled ? (
            <CategoryChip
              label={labels.noteTopicNone}
              current={filter === NOTE_CATEGORY_NONE}
              onPick={() => setFilter(NOTE_CATEGORY_NONE)}
            />
          ) : null}
        </div>
      ) : null}
      <div
        className="brew-skin brew-notes"
        ref={notesViewRef}
        data-brew-peek-lane
      >
      <div
        className="brew-notes-track"
        ref={notesTrackRef}
        data-brew-rail-track="items"
        style={{ '--brew-story-cols': storyCols } as CSSProperties}
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
              summary: doc.content_md.slice(0, 80),
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
          <BrewStory
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
            onPeek={isEditMode ? undefined : () => onPeekItem?.(item)}
            onPeekEnd={isEditMode ? undefined : onPeekEnd}
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
            <BrewStory
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
              onPeek={isEditMode ? undefined : () => onPeekItem?.(story)}
              onPeekEnd={isEditMode ? undefined : onPeekEnd}
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
