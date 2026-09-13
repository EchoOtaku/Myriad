import type { FeedStory } from '../logic/feedStories'
import type { TopicNameKey } from '../logic/topics'
import type { TimeTranslations } from '../types'

import { memo } from 'react'

import { sameFeedStory } from '../logic/feedStories'
import { StoryCard } from '../ui/StoryCard'
import { storyCardFace, storyCardInnerHtml } from './storyFace'

type BrewStoryItem = FeedStory

type StoryLabels = {
  unread: string
  starred: string
  unstar: string
} & Partial<Record<TopicNameKey, string>>

function samePlace(
  a?: { column: number; row: 1 | 2 },
  b?: { column: number; row: 1 | 2 },
): boolean {
  return a?.column === b?.column && a?.row === b?.row
}

export const BrewStory = memo(({
  item,
  times,
  locale,
  labels,
  onOpen,
  onPeek,
  onPeekEnd,
  onToggleStar,
  current = false,
  picked = false,
  picking = false,
  arrive,
  place,
  railCol,
  eagerCover = false,
  holdCover = false,
  canStar,
}: {
  item: BrewStoryItem
  times: TimeTranslations
  locale: string
  labels: StoryLabels
  onOpen?: (item: BrewStoryItem) => void
  onPeek?: (item: BrewStoryItem) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewStoryItem) => void | false
  current?: boolean
  picked?: boolean
  picking?: boolean
  arrive?: number
  place?: { column: number; row: 1 | 2 }
  railCol?: number
  eagerCover?: boolean
  holdCover?: boolean
  canStar?: boolean
}) => {
  return (
    <StoryCard
      railId={item.id}
      arrive={arrive}
      place={place}
      railCol={railCol}
      current={current}
      picked={picked}
      picking={picking}
      unreadLabel={labels.unread}
      starLabel={labels.starred}
      unstarLabel={labels.unstar}
      onOpen={onOpen ? () => onOpen(item) : undefined}
      onPeek={onPeek ? () => onPeek(item) : undefined}
      onPeekEnd={onPeekEnd}
      onToggleStar={onToggleStar ? () => onToggleStar(item) : undefined}
      eagerCover={eagerCover}
      holdCover={holdCover}
      canStar={canStar}
      face={storyCardFace(item, times, locale, labels)}
    />
  )
}, (prev, next) => (
  (prev.item === next.item || sameFeedStory(prev.item, next.item))
  && samePlace(prev.place, next.place)
  && prev.railCol === next.railCol
  && prev.locale === next.locale
  && prev.times === next.times
  && prev.labels === next.labels
  && prev.onOpen === next.onOpen
  && prev.onPeek === next.onPeek
  && prev.onPeekEnd === next.onPeekEnd
  && prev.onToggleStar === next.onToggleStar
  && prev.current === next.current
  && prev.picked === next.picked
  && prev.picking === next.picking
  && prev.arrive === next.arrive
  && prev.eagerCover === next.eagerCover
  && prev.holdCover === next.holdCover
  && prev.canStar === next.canStar
))
BrewStory.displayName = 'BrewStory'

const EMPTY_SLOTS: readonly { story: BrewStoryItem; column: number; row: 1 | 2 }[] = []

export const BrewStoryColumn = memo(({
  col,
  slots = EMPTY_SLOTS,
  holdCover,
  times,
  locale,
  labels,
  onOpen,
  onPeek,
  onPeekEnd,
  onToggleStar,
  canStar,
}: {
  col: number
  slots?: readonly { story: BrewStoryItem; column: number; row: 1 | 2 }[]
  holdCover: boolean
  times: TimeTranslations
  locale: string
  labels: StoryLabels
  onOpen?: (item: BrewStoryItem) => void
  onPeek?: (item: BrewStoryItem) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewStoryItem) => void | false
  canStar?: boolean
}) => {
  if (slots.length === 0) {
    return (
      <>
        <StoryCard
          key={`${col}:1`}
          shell
          place={{ column: col, row: 1 }}
          railCol={col}
        />
        <StoryCard
          key={`${col}:2`}
          shell
          place={{ column: col, row: 2 }}
          railCol={col}
        />
      </>
    )
  }
  return (
    <>
      {slots.map((slot) => {
        const face = storyCardFace(slot.story, times, locale, labels)
        const showStar = canStar ?? !!onToggleStar
        return (
          <StoryCard
            key={`${col}:${slot.row}`}
            railId={slot.story.id}
            place={slot}
            railCol={slot.column}
            unreadLabel={labels.unread}
            starLabel={labels.starred}
            unstarLabel={labels.unstar}
            onOpen={onOpen ? () => onOpen(slot.story) : undefined}
            onPeek={onPeek ? () => onPeek(slot.story) : undefined}
            onPeekEnd={onPeekEnd}
            onToggleStar={onToggleStar ? () => onToggleStar(slot.story) : undefined}
            holdCover={holdCover}
            canStar={canStar}
            face={face}
            html={
              onOpen || onPeek || onPeekEnd || onToggleStar
                ? undefined
                : storyCardInnerHtml(
                    face,
                    labels.unread,
                    labels.starred,
                    labels.unstar,
                    holdCover,
                    showStar,
                  )
            }
          />
        )
      })}
    </>
  )
}, (prev, next) => (
  prev.col === next.col
  && prev.slots === next.slots
  && prev.times === next.times
  && prev.locale === next.locale
  && prev.labels === next.labels
  && prev.onOpen === next.onOpen
  && prev.onPeek === next.onPeek
  && prev.onPeekEnd === next.onPeekEnd
  && prev.onToggleStar === next.onToggleStar
  && prev.canStar === next.canStar
))
BrewStoryColumn.displayName = 'BrewStoryColumn'
