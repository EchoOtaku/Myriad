/** 朋友们：两行网站卡，一行文章卡。左右挪轨不裁切。 */

import type { CSSProperties } from 'react'
import type { PhantasiItemPreview, PhantasiSource } from '../../../types/phantasi'
import type { FeedStory } from '../logic/feedStories'

import { useId, useMemo, useRef } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import {
  getIconUrl,
  normalizeThemeColor,
} from '../constants'
import { visitFriendHref } from '../logic/board'
import { PhantasiRailTitle } from '../ui/PhantasiRailTitle'
import { SiteCard } from '../ui/SiteCard'
import { PhantasiStory } from './PhantasiStory'
import { phantasiRelativeTime, usePhantasiTimes } from './time'
import { usePhantasiRailPan } from './usePhantasiRailPan'

function visitFriend(source: PhantasiSource) {
  const href = visitFriendHref(source)
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

export default function PhantasiFriends({
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
  sources: PhantasiSource[]
  stories: FeedStory[]
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onOpenItem?: (item: PhantasiItemPreview, source: PhantasiSource) => void
  onPeekItem?: (item: PhantasiItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: PhantasiItemPreview) => void
  onEditSource?: (source: PhantasiSource) => void
}) {
  const { t, locale } = useI18n()
  const itemsTitleId = useId()
  const times = usePhantasiTimes()
  const sitesViewRef = useRef<HTMLDivElement>(null)
  const sitesTrackRef = useRef<HTMLDivElement>(null)
  const itemsViewRef = useRef<HTMLDivElement>(null)
  const itemsTrackRef = useRef<HTMLDivElement>(null)
  const siteKey = useMemo(
    () => sources.map((source) => source.id).join(','),
    [sources],
  )
  const itemKey = useMemo(
    () => stories.map((item) => item.id).join(','),
    [stories],
  )
  const siteCols = Math.max(1, Math.ceil(sources.length / 2))
  const byId = new Map(sources.map((source) => [source.id, source]))

  usePhantasiRailPan(
    sitesViewRef,
    sitesTrackRef,
    sources.length > 0,
    siteKey,
    '.phantasi-site',
    undefined,
    undefined,
    true,
  )
  usePhantasiRailPan(
    itemsViewRef,
    itemsTrackRef,
    stories.length > 0,
    itemKey,
    '.phantasi-story',
    undefined,
    undefined,
    true,
  )

  const activate = (source: PhantasiSource) => {
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
    <div className="phantasi-skin phantasi-friends">
      <div className="phantasi-friends__sites" ref={sitesViewRef}>
        <div
          className="phantasi-friends__sites-track"
          ref={sitesTrackRef}
          data-phantasi-rail-track="sites"
          style={
            {
              '--phantasi-story-cols': siteCols,
            } as CSSProperties
          }
        >
        {sources.map((source, index) => {
          const latest = source.recent_items?.[0] ?? null
          return (
            <SiteCard
              key={source.id}
              id={source.id}
              railCol={Math.floor(index / 2) + 1}
              arrive={index < 8 ? index : undefined}
              name={source.name}
              description={source.description?.trim() || ''}
              icon={getIconUrl(source.icon)}
              unread={source.unread_count}
              latestTitle={latest?.title}
              latestWhen={
                latest
                  ? phantasiRelativeTime(latest.published_at, times, locale)
                  : ''
              }
              editing={isEditMode}
              picked={selectedIds?.has(source.id)}
              ink={normalizeThemeColor(source.theme_color)}
              emptyLabel={t.phantasi.noArticles}
              editLabel={t.phantasi.editSource}
              onActivate={() => activate(source)}
              onEdit={
                onEditSource ? () => onEditSource(source) : undefined
              }
            />
          )
        })}
        </div>
      </div>
      {stories.length > 0 ? (
        <>
          <PhantasiRailTitle id={itemsTitleId}>{t.phantasi.friendArticles}</PhantasiRailTitle>
          <div
            className="phantasi-friends__items"
            ref={itemsViewRef}
            aria-labelledby={itemsTitleId}
          >
            <div
              className="phantasi-friends__items-track"
              ref={itemsTrackRef}
              data-phantasi-rail-track="items"
              style={
                {
                  '--phantasi-story-cols': Math.max(1, stories.length),
                } as CSSProperties
              }
            >
              {stories.map((item, index) => (
                <PhantasiStory
                  key={item.id}
                  item={item}
                  times={times}
                  locale={locale}
                  labels={t.phantasi}
                  railCol={index + 1}
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
        </>
      ) : null}
    </div>
  )
}
