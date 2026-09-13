/** 朋友们：两行网站卡，一行文章卡。 */

import type { BrewItemPreview, BrewSource } from '../../../types/brew'
import type { FeedStory } from '../logic/feedStories'

import { useId } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import {
  getIconUrl,
  normalizeThemeColor,
} from '../constants'
import { visitFriendHref } from '../logic/board'
import { BrewRailTitle } from '../ui/BrewRailTitle'
import { SiteCard } from '../ui/SiteCard'
import { BrewStory } from './BrewStory'
import { brewRelativeTime, useBrewTimes } from './time'

function visitFriend(source: BrewSource) {
  const href = visitFriendHref(source)
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

export default function BrewFriends({
  sources,
  stories,
  isEditMode = false,
  selectedIds,
  onToggleSelect,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onEditSource,
}: {
  sources: BrewSource[]
  stories: FeedStory[]
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onOpenItem?: (item: BrewItemPreview, source: BrewSource) => void
  onPeekItem?: (item: BrewItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewItemPreview) => void
  onEditSource?: (source: BrewSource) => void
}) {
  const { t, locale } = useI18n()
  const itemsTitleId = useId()
  const times = useBrewTimes()
  const byId = new Map(sources.map((source) => [source.id, source]))

  const activate = (source: BrewSource) => {
    if (isEditMode) {
      onToggleSelect?.(source.id)
      return
    }
    visitFriend(source)
  }

  const openArticle = (item: FeedStory, sourceId?: number) => {
    const sid = sourceId ?? item.source_id
    const source = sid != null ? byId.get(sid) : undefined
    if (!source || isEditMode) {
      if (isEditMode && sid != null) onToggleSelect?.(sid)
      return
    }
    onOpenItem?.(item, source)
  }

  return (
    <div className="brew-skin brew-friends">
      <div className="brew-friends__sites">
        {sources.map((source, index) => {
          const latest = source.recent_items?.[0] ?? null
          return (
            <SiteCard
              key={source.id}
              id={source.id}
              arrive={index < 8 ? index : undefined}
              name={source.name}
              description={source.description?.trim() || ''}
              icon={getIconUrl(source.icon)}
              unread={source.unread_count}
              latestTitle={latest?.title}
              latestWhen={
                latest
                  ? brewRelativeTime(latest.published_at, times, locale)
                  : ''
              }
              editing={isEditMode}
              picked={selectedIds?.has(source.id)}
              ink={normalizeThemeColor(source.theme_color)}
              emptyLabel={t.brew.noArticles}
              editLabel={t.brew.editSource}
              onActivate={() => activate(source)}
              onOpenLatest={
                latest
                  ? () => openArticle(latest, source.id)
                  : undefined
              }
              onEdit={
                onEditSource ? () => onEditSource(source) : undefined
              }
            />
          )
        })}
      </div>
      <BrewRailTitle id={itemsTitleId}>{t.brew.friendArticles}</BrewRailTitle>
      <div className="brew-friends__items" aria-labelledby={itemsTitleId}>
        {stories.map((item, index) => (
          <BrewStory
            key={item.id}
            item={item}
            times={times}
            locale={locale}
            labels={t.brew}
            arrive={index < 8 ? index : undefined}
            onOpen={() => openArticle(item)}
            onPeek={() => onPeekItem?.(item)}
            onPeekEnd={onPeekEnd}
            onToggleStar={
              onToggleStar && !isEditMode
                ? (story) => onToggleStar(story)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}
