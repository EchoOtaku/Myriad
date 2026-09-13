/** 手记：云端稿、已发布、剩下的自有源都走文章卡。 */

import type { BrewItemPreview, BrewNoteDoc, BrewSource } from '../../../types/brew'
import type { HomeBoardNote } from '../logic/homeBoard'

import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../../contexts/I18nContext'
import { brewOwnItemPath, getIconUrl, getImageUrl } from '../constants'
import { isSiteSource, visitFriendHref } from '../logic/board'
import { toNoteStory } from '../logic/homeBoard'
import { topicDisplayName, topicHue, topicNameKey } from '../logic/topics'
import {
  leftoverNoteSources,
  noteDocKicker,
  sourceLatestStory,
} from '../notes/noteBoard'
import { StoryCard } from '../ui/StoryCard'
import { BrewStory } from './BrewStory'
import { useBrewTimes } from './time'

function openLink(source: BrewSource) {
  const href = visitFriendHref(source)
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
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

  let arriveAt = 0
  const nextArrive = () => {
    const index = arriveAt
    arriveAt += 1
    return index < 8 ? index : undefined
  }

  return (
    <div className="brew-skin brew-notes">
      {docs.map((doc) => {
        const topicKey = doc.topic ? topicNameKey(doc.topic) : null
        return (
          <StoryCard
            key={`doc:${doc.id}`}
            arrive={nextArrive()}
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
              topic:
                doc.topic && topicKey
                  ? topicDisplayName(
                      { key: doc.topic, nameKey: topicKey },
                      labels,
                    )
                  : null,
              hue: doc.topic ? topicHue(doc.topic) : null,
            }}
          />
        )
      })}
      {notes.map((note) => {
        const source = byId.get(note.source_id)
        const item = toNoteStory(note, source)
        return (
          <BrewStory
            key={`note:${note.id}`}
            item={item}
            times={times}
            locale={locale}
            labels={labels}
            arrive={nextArrive()}
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
      {leftover.map((source) => {
        const story = sourceLatestStory(source)
        const arrive = nextArrive()
        if (story) {
          return (
            <BrewStory
              key={`source:${source.id}`}
              item={story}
              times={times}
              locale={locale}
              labels={labels}
              arrive={arrive}
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
        return (
          <StoryCard
            key={`source:${source.id}`}
            arrive={arrive}
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
              source: source.name,
              sourceIcon: getIconUrl(source.icon),
            }}
          />
        )
      })}
    </div>
  )
}
